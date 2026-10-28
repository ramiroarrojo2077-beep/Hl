"""Toolkit de animación procedural del personaje.

La animación se compone como funciones del tiempo (por frame) y se escribe en f-curves
con un buffer (un keyframe por frame, interpolación lineal). Piernas y brazos siempre usan
IK: las posiciones de manos/pies se calculan en espacio de mundo, lo que garantiza que las
manos lleguen exactamente a los objetos (agarre sin atravesar ni "agarrar aire").
"""
import math
import os
import numpy as np
import bpy
from mathutils import Vector, Matrix, Quaternion, Euler

import mh_loader as mh
from util import ease, ease_io, smoothstep

FPS = 30


# ---------------------------------------------------------------------------
# Buffer de keyframes
# ---------------------------------------------------------------------------

class KeyBuffer:
    def __init__(self, idblock):
        self.id = idblock
        self.data = {}

    def key(self, path, index, frame, value):
        self.data.setdefault((path, index), {})[frame] = float(value)

    def key_vec(self, path, frame, vec):
        for i, v in enumerate(vec):
            self.key(path, i, frame, v)

    def write(self):
        ad = self.id.animation_data_create()
        act = ad.action
        if act is None:
            act = bpy.data.actions.new(self.id.name + '_act')
            ad.action = act
        for (path, idx), kv in self.data.items():
            fc = act.fcurve_ensure_for_datablock(self.id, path, index=idx)
            frames = sorted(kv)
            n0 = len(fc.keyframe_points)
            fc.keyframe_points.add(len(frames))
            co = np.empty(2 * len(frames), np.float32)
            co[0::2] = frames
            co[1::2] = [kv[f] for f in frames]
            pts = fc.keyframe_points
            arr = np.empty(2 * len(pts), np.float32)
            pts.foreach_get('co', arr)
            arr[2 * n0:] = co
            pts.foreach_set('co', arr)
            interp = np.empty(len(pts), np.int32)
            pts.foreach_get('interpolation', interp)
            interp[n0:] = 1  # LINEAR
            pts.foreach_set('interpolation', interp)
            fc.update()
        self.data = {}


def obj_keys(ob):
    if not hasattr(ob, '_kb'):
        pass
    return KeyBuffer(ob)


# ---------------------------------------------------------------------------
# Curvas de tiempo
# ---------------------------------------------------------------------------

class Track:
    """Valor (escalar o vector) interpolado entre claves con easing suave."""

    def __init__(self, keys=None, default=0.0):
        self.keys = sorted(keys or [], key=lambda k: k[0])
        self.default = default

    def add(self, t, v):
        self.keys.append((t, v))
        self.keys.sort(key=lambda k: k[0])
        return self

    def __call__(self, t):
        ks = self.keys
        if not ks:
            return self.default
        if t <= ks[0][0]:
            return ks[0][1]
        if t >= ks[-1][0]:
            return ks[-1][1]
        for (t0, v0), (t1, v1) in zip(ks[:-1], ks[1:]):
            if t0 <= t <= t1:
                u = ease_io((t - t0) / max(t1 - t0, 1e-9))
                if isinstance(v0, (Vector, np.ndarray, tuple, list)):
                    a = np.asarray(v0, float)
                    b = np.asarray(v1, float)
                    return a + (b - a) * u
                return v0 + (v1 - v0) * u
        return ks[-1][1]


# ---------------------------------------------------------------------------
# Unidades faciales (BVH de MakeHuman)
# ---------------------------------------------------------------------------

_FACE_CACHE = {}


def face_units():
    if 'units' in _FACE_CACHE:
        return _FACE_CACHE['units']
    import json
    J, F = mh.parse_bvh(os.path.join(mh.MH_DIR, 'face-poseunits.bvh'))
    names = json.load(open(os.path.join(mh.MH_DIR, 'face-poseunits.json')))['framemapping']
    units = {}
    for fi, uname in enumerate(names):
        frame = F[fi]
        idx = 0
        rots = {}
        for j in J:
            ch = j['channels']
            vals = frame[idx: idx + len(ch)]
            idx += len(ch)
            if j['name'] is None or not ch:
                continue
            R = Matrix.Identity(3)
            mats = []
            for c, v in zip(ch, vals):
                if c.endswith('rotation'):
                    ax = c[0]
                    mats.append(Matrix.Rotation(math.radians(v), 3, ax))
            for m in mats:
                R = R @ m
            if (R - Matrix.Identity(3)).to_quaternion().angle if False else abs(R.to_quaternion().angle) > 1e-5:
                rots[j['name']] = R.to_quaternion()
        units[uname] = rots
    _FACE_CACHE['units'] = units
    return units


EXPRESSIONS = {
    'neutral': {},
    'smile': {'LeftCheekUp': 0.45, 'RightCheekUp': 0.45, 'MouthLeftPullUp': 0.55, 'MouthRightPullUp': 0.55,
              'LeftLowerLidUp': 0.15, 'RightLowerLidUp': 0.15},
    'smile_soft': {'MouthLeftPullUp': 0.3, 'MouthRightPullUp': 0.3, 'LeftCheekUp': 0.2, 'RightCheekUp': 0.2},
    'curious': {'LeftOuterBrowUp': 0.55, 'LeftInnerBrowUp': 0.35, 'RightOuterBrowUp': 0.2,
                'MouthLeftPullUp': 0.12},
    'focus': {'LeftBrowDown': 0.35, 'RightBrowDown': 0.35, 'LeftLowerLidUp': 0.25, 'RightLowerLidUp': 0.25,
              'lowerLipUp': 0.15},
    'amazed': {'LeftOuterBrowUp': 0.6, 'RightOuterBrowUp': 0.6, 'LeftInnerBrowUp': 0.5, 'RightInnerBrowUp': 0.5,
               'LeftUpperLidOpen': 0.35, 'RightUpperLidOpen': 0.35, 'JawDrop': 0.12,
               'MouthLeftPullUp': 0.2, 'MouthRightPullUp': 0.2},
    'explain': {'LeftOuterBrowUp': 0.25, 'RightOuterBrowUp': 0.25, 'MouthLeftPullUp': 0.2,
                'MouthRightPullUp': 0.2},
}

# ---------------------------------------------------------------------------
# Poses de mano (curl por falange en grados; pulgar por (abd, curl1, curl2, curl3))
# ---------------------------------------------------------------------------
HAND_POSES = {
    'relaxed': dict(f=[(12, 18, 12), (15, 22, 14), (18, 26, 16), (22, 30, 18)], thumb=(10, 8, 10, 10), spread=3),
    'open': dict(f=[(2, 3, 2), (2, 3, 2), (3, 3, 2), (4, 4, 3)], thumb=(25, 0, 3, 3), spread=8),
    'grip': dict(f=[(55, 70, 45), (60, 75, 48), (62, 78, 50), (65, 80, 50)], thumb=(45, 25, 25, 30), spread=0),
    'point': dict(f=[(3, 3, 2), (70, 95, 60), (75, 95, 60), (78, 95, 60)], thumb=(35, 25, 30, 25), spread=0),
    'pinch': dict(f=[(35, 40, 25), (25, 35, 20), (30, 45, 25), (35, 50, 25)], thumb=(45, 20, 20, 15), spread=0),
    'flat_press': dict(f=[(5, 5, 3), (5, 6, 4), (6, 7, 4), (8, 8, 5)], thumb=(15, 3, 3, 3), spread=2),
}


def blend_hand(weights):
    """weights: dict pose->w. Devuelve curls (4x3) y pulgar (4)."""
    tot = sum(weights.values()) or 1.0
    f = np.zeros((4, 3))
    th = np.zeros(4)
    sp = 0.0
    for k, w in weights.items():
        p = HAND_POSES[k]
        f += np.array(p['f']) * w / tot
        th += np.array(p['thumb']) * w / tot
        sp += p['spread'] * w / tot
    return f, th, sp


# ---------------------------------------------------------------------------
# Actor
# ---------------------------------------------------------------------------

class Actor:
    FINGERS = ['finger2', 'finger3', 'finger4', 'finger5']

    def __init__(self, rig):
        self.rig = rig
        self.kb = KeyBuffer(rig)
        bones = rig.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.rest3 = {k: m.to_3x3() for k, m in self.rest.items()}
        self.mw = rig.matrix_world.copy()
        self.mwi = self.mw.inverted()
        for pb in rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        self.units = face_units()
        self.face_bones = sorted({b for u in self.units.values() for b in u} & set(bones.keys()))
        self.prev_q = {}
        self.calib = rig.get('calib') or {}
        # datos de reposo útiles
        self.hip_h = self.rest['root'].translation.z
        self.root_rest = self.rest['root'].copy()
        self.palm_n = {s: Vector(bones['grip.' + s].get('palm_normal', (0, -1, 0))) for s in 'LR'}

    # -- conversiones ------------------------------------------------------
    def world_to_arm(self, v):
        return self.mwi @ Vector(v)

    def basis_from_world_rot(self, bone, q_world):
        """Rotación expresada en ejes de armature (reposo) -> rotación local del hueso."""
        B = self.rest3[bone]
        R = q_world.to_matrix()
        return (B.transposed() @ R @ B).to_quaternion()

    def key_rot(self, frame, bone, q_local):
        prev = self.prev_q.get(bone)
        q = q_local.copy()
        if prev is not None and prev.dot(q) < 0:
            q.negate()
        self.prev_q[bone] = q
        self.kb.key_vec('pose.bones["%s"].rotation_quaternion' % bone, frame, q)

    def key_unparented(self, frame, bone, M_arm):
        """Fija la matriz (espacio armature) de un hueso sin padre: loc + rot."""
        R = self.rest[bone]
        basis = R.inverted() @ M_arm
        loc, q, _ = basis.decompose()
        self.kb.key_vec('pose.bones["%s"].location' % bone, frame, loc)
        self.key_rot(frame, bone, q)

    def key_loc(self, frame, bone, loc_local):
        self.kb.key_vec('pose.bones["%s"].location' % bone, frame, loc_local)

    def key_influence(self, frame, bone, cname, val):
        self.kb.key('pose.bones["%s"].constraints["%s"].influence' % (bone, cname), 0, frame, val)

    # -- huesos de control ---------------------------------------------------
    def set_root(self, frame, pos_world, yaw, lean=0.0, sway=0.0):
        """Coloca la pelvis (hueso root) en una posición de mundo y orientación (yaw en rad)."""
        R0 = self.root_rest
        q = Quaternion((0, 0, 1), yaw) @ Quaternion((1, 0, 0), lean) @ Quaternion((0, 1, 0), sway)
        M = Matrix.Translation(self.world_to_arm(pos_world)) @ q.to_matrix().to_4x4() @ R0.to_3x3().to_4x4()
        self.key_unparented(frame, 'root', M)
        return q

    def body_frame(self, pos_world, yaw):
        """Matriz mundo de un marco 'cuerpo' (x izquierda del personaje, -y adelante)."""
        return Matrix.Translation(pos_world) @ Matrix.Rotation(yaw, 4, 'Z')

    def set_ik_hand(self, frame, side, pos_world, finger_dir, palm_dir):
        """Muñeca en pos_world, dedos apuntando a finger_dir, palma mirando a palm_dir (mundo)."""
        bone = 'IK_hand.' + side
        B = self.rest3['wrist.' + side]
        y_l = Vector((0, 1, 0))
        pn_l = B.transposed() @ self.palm_n[side]
        q_l = (pn_l - y_l * pn_l.dot(y_l)).normalized()
        F = (self.mwi.to_3x3() @ Vector(finger_dir)).normalized()
        P = (self.mwi.to_3x3() @ Vector(palm_dir))
        P = (P - F * P.dot(F)).normalized()
        src = Matrix((y_l, q_l, y_l.cross(q_l))).transposed()
        dst = Matrix((F, P, F.cross(P))).transposed()
        R = dst @ src.inverted()  # mapea ejes locales del hueso -> ejes de armature
        M = Matrix.Translation(self.world_to_arm(pos_world)) @ R.to_4x4()
        self.key_unparented(frame, bone, M)

    def hand_basis_sign(self, side):
        """Signo s tal que (índice->meñique) = s * (dedos x palma) en reposo."""
        B = self.rest
        F0 = (B['wrist.' + side].to_3x3() @ Vector((0, 1, 0))).normalized()
        P0 = self.palm_n[side].normalized()
        W0 = (B['finger5-1.' + side].translation - B['finger2-1.' + side].translation).normalized()
        return 1.0 if W0.dot(F0.cross(P0)) > 0 else -1.0

    def grasp_frame(self, side, center, axis, finger_hint, radius=0.02, along=0.0):
        """Calcula (pos_muñeca, dir_dedos, dir_palma) para envolver un cilindro.

        center: punto del eje del objeto donde va el centro de la palma.
        axis: dirección del eje del objeto; el índice queda hacia +axis, el meñique hacia -axis.
        finger_hint: dirección aproximada de los dedos (se ortogonaliza respecto del eje).
        """
        A = Vector(axis).normalized()
        F = Vector(finger_hint)
        F = (F - A * F.dot(A)).normalized()
        W = -A
        s = self.hand_basis_sign(side)
        P = (W.cross(F) * s).normalized()
        # posición: el bone de agarre (centro de palma) a 'radius' del eje, del lado opuesto a P
        B = self.rest3['wrist.' + side]
        y_l = Vector((0, 1, 0))
        pn_l = B.transposed() @ self.palm_n[side]
        q_l = (pn_l - y_l * pn_l.dot(y_l)).normalized()
        src = Matrix((y_l, q_l, y_l.cross(q_l))).transposed()
        dst = Matrix((F, P, F.cross(P))).transposed()
        R = dst @ src.inverted()
        g = self.rest['grip.' + side].translation - self.rest['wrist.' + side].translation
        g_world = R @ (B.transposed() @ g)
        palm_center = Vector(center) - P * (radius + 0.012) + A * along
        wrist = palm_center - g_world
        return wrist, F, P

    def grip_offset(self, side):
        """Transformación de muñeca -> centro de agarre (en espacio de la muñeca)."""
        w = self.rest['wrist.' + side]
        g = self.rest['grip.' + side]
        return w.inverted() @ g

    def set_ik_foot(self, frame, side, pos_world, yaw, pitch=0.0):
        bone = 'IK_foot.' + side
        B = self.rest['foot.' + side]
        q = Quaternion((0, 0, 1), yaw) @ Quaternion((1, 0, 0), pitch)
        R = self.mwi.to_3x3().to_quaternion() @ q
        M = Matrix.Translation(self.world_to_arm(pos_world)) @ (R.to_matrix() @ B.to_3x3()).to_4x4()
        self.key_unparented(frame, bone, M)

    def set_pole(self, frame, name, pos_world):
        R = self.rest[name]
        loc = self.world_to_arm(pos_world) - R.translation
        # location del hueso en espacio local de reposo
        self.key_loc(frame, name, R.to_3x3().transposed() @ loc)

    def set_look(self, frame, target_world, eyes_target=None):
        for bn, tgt in (('look', target_world), ('look_eyes', eyes_target or target_world)):
            R = self.rest[bn]
            loc = self.world_to_arm(tgt) - R.translation
            self.key_loc(frame, bn, R.to_3x3().transposed() @ loc)

    # -- FK de columna/cabeza --------------------------------------------------
    def set_world_rot(self, frame, bone, q_world):
        self.key_rot(frame, bone, self.basis_from_world_rot(bone, q_world))

    # -- manos -----------------------------------------------------------------
    def set_hand(self, frame, side, weights):
        f, th, sp = blend_hand(weights)
        cs = self.calib.get('curl_sign_' + side, 1.0)
        for i, fn in enumerate(self.FINGERS):
            for j in range(3):
                bn = '%s-%d.%s' % (fn, j + 1, side)
                ang = math.radians(f[i][j]) * cs
                q = Quaternion((1, 0, 0), ang)
                if j == 0:
                    spread = math.radians(sp * (i - 1.2)) * self.calib.get('spread_sign_' + side, 1.0)
                    q = q @ Quaternion((0, 0, 1), spread)
                self.key_rot(frame, bn, q)
        ts = self.calib.get('thumb_sign_' + side, [1.0, 1.0])
        abd, c1, c2, c3 = [math.radians(a) for a in th]
        q1 = Quaternion((0, 0, 1), abd * ts[0]) @ Quaternion((1, 0, 0), c1 * ts[1])
        self.key_rot(frame, 'finger1-1.' + side, q1)
        self.key_rot(frame, 'finger1-2.' + side, Quaternion((1, 0, 0), c2 * ts[1]))
        self.key_rot(frame, 'finger1-3.' + side, Quaternion((1, 0, 0), c3 * ts[1]))

    # -- cara ----------------------------------------------------------------
    def set_face(self, frame, weights):
        acc = {}
        for uname, w in weights.items():
            if abs(w) < 1e-4:
                continue
            for bone, q in self.units.get(uname, {}).items():
                qi = Quaternion().slerp(q, min(max(w, 0.0), 1.2))
                acc[bone] = qi @ acc.get(bone, Quaternion())
        for bone in self.face_bones:
            if bone.startswith('eye.'):
                continue
            q = acc.get(bone, Quaternion())
            self.key_rot(frame, bone, self.basis_from_world_rot(bone, q))

    def write(self):
        self.kb.write()


# ---------------------------------------------------------------------------
# Caminata procedural
# ---------------------------------------------------------------------------

class Path2D:
    def __init__(self, pts):
        self.p = [np.array(p[:2], float) for p in pts]
        seg = [np.linalg.norm(b - a) for a, b in zip(self.p[:-1], self.p[1:])]
        self.cum = np.concatenate([[0], np.cumsum(seg)])
        self.length = float(self.cum[-1])

    def at(self, s):
        s = min(max(s, 0.0), self.length)
        i = int(np.searchsorted(self.cum, s, side='right') - 1)
        i = min(max(i, 0), len(self.p) - 2)
        a, b = self.p[i], self.p[i + 1]
        L = max(self.cum[i + 1] - self.cum[i], 1e-9)
        u = (s - self.cum[i]) / L
        pos = a + (b - a) * u
        return pos

    def tangent(self, s, win=0.35):
        a = self.at(s - win)
        b = self.at(s + win)
        d = b - a
        if np.linalg.norm(d) < 1e-9:
            d = self.p[-1] - self.p[0]
        return d / np.linalg.norm(d)


def yaw_from_dir(d):
    """Yaw tal que el frente del personaje (-Y local) apunte a d (2D)."""
    return math.atan2(d[0], -d[1])


class Walk:
    """Plan de caminata entre t0 y t1 a lo largo de un camino 2D."""

    def __init__(self, path_pts, t0, t1, step=0.68, foot_sep=0.105):
        self.path = Path2D(path_pts)
        self.t0, self.t1 = t0, t1
        S = self.path.length
        n = max(2, int(round(S / step)))
        self.d = S / n
        self.n = n
        self.sep = foot_sep
        # perfiles de progreso: arranque y frenado suaves
        self.S = S

    def progress(self, t):
        u = min(max((t - self.t0) / (self.t1 - self.t0), 0.0), 1.0)
        a = 0.18  # fracción de aceleración/frenado
        # velocidad trapezoidal integrada
        vmax = 1.0 / (1 - a)
        if u < a:
            s = 0.5 * vmax * u * u / a
        elif u > 1 - a:
            r = 1 - u
            s = 1 - 0.5 * vmax * r * r / a
        else:
            s = 0.5 * vmax * a + vmax * (u - a)
        return s * self.S

    def plants(self, side):
        d = self.d
        n = self.n
        if side == 'R':
            pos = [0.0] + [d * k for k in range(1, n, 2)] + [self.S]
        else:
            pos = [0.0] + [d * k for k in range(2, n, 2)] + [self.S]
        out = []
        for p in pos:
            if not out or abs(out[-1] - p) > 1e-6:
                out.append(p)
        return out

    def plant_pos(self, side, s):
        lat = self.sep if side == 'L' else -self.sep
        p = self.path.at(s)
        tg = self.path.tangent(s)
        left = np.array([-tg[1], tg[0]])
        return p + left * lat

    def foot_state(self, side, t):
        """Devuelve (pos3 mundo, yaw, pitch) del pie."""
        b = self.progress(t)
        pl = self.plants(side)
        d = self.d
        pp = lambda s: self.plant_pos(side, s)
        closing = self._closing_side() == side
        for k in range(len(pl) - 1):
            pa, pb = pl[k], pl[k + 1]
            if closing and k == len(pl) - 2:
                tc0 = self.t1 - 0.12
                tc1 = tc0 + 0.45
                if t <= tc0:
                    return self._plant(pp, pa)
                u = min((t - tc0) / (tc1 - tc0), 1.0)
                return self._swing(pp, pa, pb, u, h=0.02, toe_off=False)
            # apoyo simétrico respecto de la cadera (el pie apoya ~0.55 paso adelante y despega ~0.65 paso atrás)
            w0 = pb - 1.35 * d
            w1 = pb - 0.55 * d
            if k == 0:
                w0 = max(w0, -0.05 * d)
            if b < w0:
                # final del apoyo: el talón se levanta sobre la punta antes del despegue
                hr = 0.35 * d
                heel = smoothstep(w0 - hr, w0, b) if k > 0 or w0 > hr else 0.0
                return self._plant(pp, pa, -self.TOE_OFF * heel)
            if b <= w1:
                u = (b - w0) / max(w1 - w0, 1e-9)
                return self._swing(pp, pa, pb, u, toe_off=(k > 0 or w0 > 0.35 * d))
        return self._plant(pp, pl[-1])

    def _closing_side(self):
        pl_l = self.plants('L')
        pl_r = self.plants('R')
        return 'L' if pl_l[-2] > pl_r[-2] else 'R'

    TOE_OFF = 0.3    # ángulo del pie al despegar (rad)

    def _plant(self, plant_pos, s, pitch=0.0):
        p = plant_pos(s)
        yaw = yaw_from_dir(self.path.tangent(s))
        return np.array([p[0], p[1], 0.0]), yaw, pitch

    def _swing(self, plant_pos, sa, sb, u, h=0.025, toe_off=True):
        ue = ease_io(u, 1.6)
        pa = plant_pos(sa)
        pb = plant_pos(sb)
        p = pa + (pb - pa) * ue
        z = h * math.sin(math.pi * u) ** 1.2
        ya = yaw_from_dir(self.path.tangent(sa))
        yb = yaw_from_dir(self.path.tangent(sb))
        dy = (yb - ya + math.pi) % (2 * math.pi) - math.pi
        yaw = ya + dy * ue
        if u < 0.6:
            if toe_off:
                pitch = -self.TOE_OFF * (1 - smoothstep(0.0, 0.45, u))
            else:
                pitch = -0.2 * math.sin(math.pi * min(u * 1.6, 1.0))
        else:
            pitch = 0.25 * math.sin(math.pi * (u - 0.6) / 0.4)
        return np.array([p[0], p[1], z]), yaw, pitch

    def body_state(self, t):
        b = self.progress(t)
        p = self.path.at(b)
        tg = self.path.tangent(b, 0.5)
        yaw = yaw_from_dir(tg)
        phase = b / self.d * math.pi
        moving = 1.0 if self.t0 < t < self.t1 else 0.0
        amp = smoothstep(self.t0, self.t0 + 0.6, t) * (1 - smoothstep(self.t1 - 0.6, self.t1, t))
        bob = -0.022 * (0.5 + 0.5 * math.cos(2 * phase)) * amp
        sway = 0.018 * math.sin(phase) * amp
        return np.array([p[0], p[1]]), yaw, bob, sway, amp, phase


def turn_angle(a, b):
    return (b - a + math.pi) % (2 * math.pi) - math.pi


# ---------------------------------------------------------------------------
# Calibración numérica del rig (signos de curl y ángulos de polo IK)
# ---------------------------------------------------------------------------

def _eval():
    bpy.context.view_layer.update()


def calibrate(rig):
    pb = rig.pose.bones
    B = rig.data.bones
    calib = {}
    for pbn in pb:
        pbn.rotation_mode = 'QUATERNION'
    # desactivar IK de brazos para medir dedos en reposo
    for side in 'LR':
        palm = Vector(B['grip.' + side]['palm_normal'])
        tip0 = None
        _eval()
        tip0 = pb['finger3-3.' + side].tail.copy()
        pb['finger3-1.' + side].rotation_quaternion = Quaternion((1, 0, 0), math.radians(30))
        _eval()
        tip1 = pb['finger3-3.' + side].tail.copy()
        pb['finger3-1.' + side].rotation_quaternion = Quaternion()
        calib['curl_sign_' + side] = 1.0 if (tip1 - tip0).dot(palm) > 0 else -1.0
        # separación: dedo 5 se aleja del 2 con giro +Z en finger5-1
        _eval()
        a0 = (pb['finger5-3.' + side].tail - pb['finger2-3.' + side].tail).length
        pb['finger5-1.' + side].rotation_quaternion = Quaternion((0, 0, 1), math.radians(10))
        _eval()
        a1 = (pb['finger5-3.' + side].tail - pb['finger2-3.' + side].tail).length
        pb['finger5-1.' + side].rotation_quaternion = Quaternion()
        calib['spread_sign_' + side] = 1.0 if a1 > a0 else -1.0
        # pulgar: abd (Z) lleva la punta hacia la palma; curl (X) la acerca al índice
        _eval()
        t0 = pb['finger1-3.' + side].tail.copy()
        idx = pb['finger2-1.' + side].head.copy()
        pb['finger1-1.' + side].rotation_quaternion = Quaternion((0, 0, 1), math.radians(20))
        _eval()
        t1 = pb['finger1-3.' + side].tail.copy()
        pb['finger1-1.' + side].rotation_quaternion = Quaternion((1, 0, 0), math.radians(20))
        _eval()
        t2 = pb['finger1-3.' + side].tail.copy()
        pb['finger1-1.' + side].rotation_quaternion = Quaternion()
        s_abd = 1.0 if (t1 - t0).dot(palm) > 0 else -1.0
        s_curl = 1.0 if (t2 - idx).length < (t0 - idx).length else -1.0
        calib['thumb_sign_' + side] = [s_abd, s_curl]
    _eval()
    # ángulos de polo: probar candidatos y elegir el que orienta rodilla/codo hacia el polo
    for side in 'LR':
        for chain, ctl, end, mid, pole in (('IK_leg', 'IK_foot.' + side, 'lowerleg02.' + side, 'lowerleg01.' + side, 'pole_leg.' + side),
                                           ('IK_arm', 'IK_hand.' + side, 'lowerarm02.' + side, 'lowerarm01.' + side, 'pole_arm.' + side)):
            con = pb[end].constraints[chain]
            infl0 = con.influence
            con.influence = 1.0
            # acercar el objetivo para forzar flexión
            root_bone = 'upperleg01.' + side if chain == 'IK_leg' else 'upperarm01.' + side
            start = B[root_bone].head_local
            tgt0 = B[ctl].head_local
            pb[ctl].location = (0, 0, 0)
            _eval()
            vec = (tgt0 - start)
            want = start + vec * 0.75
            # mover el control (sin padre): location en espacio local de reposo
            R = B[ctl].matrix_local.to_3x3()
            pb[ctl].location = R.transposed() @ (want - tgt0)
            best = None
            for ang in range(-180, 180, 15):
                con.pole_angle = math.radians(ang)
                _eval()
                m = pb[mid].head
                a = pb[root_bone].head
                e = pb[ctl].head
                line = (e - a).normalized()
                off = (m - a) - line * (m - a).dot(line)
                pdir = (pb[pole].head - a)
                pdir = pdir - line * pdir.dot(line)
                score = off.normalized().dot(pdir.normalized()) if off.length > 1e-5 else -2
                if best is None or score > best[0]:
                    best = (score, ang)
            con.pole_angle = math.radians(best[1])
            calib['pole_%s_%s' % (chain, side)] = best[1]
            pb[ctl].location = (0, 0, 0)
            con.influence = infl0
    _eval()
    rig['calib'] = calib
    return calib
