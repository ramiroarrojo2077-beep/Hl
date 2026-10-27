"""Performer: compone la actuación completa del personaje cuadro a cuadro.

Uso típico en un plano:
    P = Performer(actor, pos=(x, y), yaw=0)
    P.walk(t0, t1, [(x0, y0), (x1, y1)])
    P.hand('R', t, ('world', pos, finger_dir, palm_dir))   # o 'rest'
    P.hand_pose('R', t, {'grip': 1})
    P.look_at(t, (x, y, z))
    P.expression(t, 'smile')
    P.attach(obj, 'R', t_grab, t_release)
    P.bake(frame_start, frame_end, fps)
"""
import math
import random
import numpy as np
import bpy
from mathutils import Vector, Matrix, Quaternion

from anim import Actor, Walk, Track, yaw_from_dir, turn_angle, EXPRESSIONS, blend_hand
from util import ease, ease_io, smoothstep


def _lerp(a, b, u):
    return a + (b - a) * u


class Stand:
    def __init__(self, t0, t1, pos, yaw, sep):
        self.t0, self.t1, self.pos, self.yaw, self.sep = t0, t1, np.array(pos, float), yaw, sep

    def body(self, t):
        return self.pos, self.yaw, 0.0, 0.0, 0.0, 0.0

    def foot(self, side, t):
        left = np.array([math.cos(self.yaw), math.sin(self.yaw)])
        lat = self.sep if side == 'L' else -self.sep
        p = self.pos + left * lat
        return np.array([p[0], p[1], 0.0]), self.yaw, 0.0


class Turn:
    def __init__(self, t0, t1, pos, yaw0, yaw1, sep):
        self.t0, self.t1, self.pos, self.sep = t0, t1, np.array(pos, float), sep
        self.yaw0 = yaw0
        self.yaw1 = yaw0 + turn_angle(yaw0, yaw1)

    def _yaw(self, u):
        return _lerp(self.yaw0, self.yaw1, ease_io(u))

    def body(self, t):
        u = (t - self.t0) / max(self.t1 - self.t0, 1e-6)
        u = min(max(u, 0), 1)
        return self.pos, self._yaw(u), -0.01 * math.sin(math.pi * u), 0.0, 0.0, 0.0

    def foot(self, side, t):
        u = min(max((t - self.t0) / max(self.t1 - self.t0, 1e-6), 0), 1)
        # primer pie del lado hacia donde gira
        first = 'L' if self.yaw1 > self.yaw0 else 'R'
        a, b = (0.0, 0.6) if side == first else (0.4, 1.0)
        v = min(max((u - a) / (b - a), 0), 1)
        lat = self.sep if side == 'L' else -self.sep

        def place(yaw):
            left = np.array([math.cos(yaw), math.sin(yaw)])
            return self.pos + left * lat

        p0 = place(self.yaw0)
        p1 = place(self.yaw1)
        ve = ease_io(v)
        p = _lerp(p0, p1, ve)
        z = 0.04 * math.sin(math.pi * v)
        return np.array([p[0], p[1], z]), _lerp(self.yaw0, self.yaw1, ve), 0.0


class SideStep:
    """Paso lateral/corto sin girar el cuerpo (ej.: correrse a lo largo de la mesada)."""

    def __init__(self, t0, t1, pos0, pos1, yaw, sep):
        self.t0, self.t1, self.yaw, self.sep = t0, t1, yaw, sep
        self.p0, self.p1 = np.array(pos0, float), np.array(pos1, float)
        left = np.array([math.cos(yaw), math.sin(yaw)])
        self.lead = 'L' if np.dot(self.p1 - self.p0, left) > 0 else 'R'

    def body(self, t):
        u = min(max((t - self.t0) / max(self.t1 - self.t0, 1e-6), 0), 1)
        return self.p0 + (self.p1 - self.p0) * ease_io(u), self.yaw, -0.012 * math.sin(math.pi * u), 0.0, 0.0, 0.0

    def foot(self, side, t):
        u = min(max((t - self.t0) / max(self.t1 - self.t0, 1e-6), 0), 1)
        a, b = (0.0, 0.6) if side == self.lead else (0.4, 1.0)
        v = min(max((u - a) / (b - a), 0), 1)
        left = np.array([math.cos(self.yaw), math.sin(self.yaw)])
        lat = self.sep if side == 'L' else -self.sep
        p = self.p0 + (self.p1 - self.p0) * ease_io(v) + left * lat
        return np.array([p[0], p[1], 0.045 * math.sin(math.pi * v)]), self.yaw, 0.0


class WalkSeg:
    def __init__(self, walk):
        self.w = walk
        self.t0, self.t1 = walk.t0, walk.t1 + 0.4

    def body(self, t):
        p, yaw, bob, sway, amp, phase = self.w.body_state(t)
        return p, yaw, bob, sway, amp, phase

    def foot(self, side, t):
        return self.w.foot_state(side, t)


class Performer:
    def __init__(self, actor, pos, yaw=0.0, t0=0.0, sep=0.105, seed=7):
        self.a = actor
        self.sep = sep
        self.segs = [Stand(-1e9, t0, pos, yaw, sep)]
        self.cur_pos = np.array(pos, float)
        self.cur_yaw = yaw
        self.cur_t = t0
        self.lean = Track(default=0.0)
        self.crouch = Track(default=0.0)
        self.twist = Track(default=0.0)
        self.hip_shift = Track(default=0.0)
        self.hands = {'L': [], 'R': []}
        self.poses = {'L': [], 'R': []}
        self.looks = []
        self.faces = []
        self.attachments = []
        self.extra = []
        self.rnd = random.Random(seed)
        self.blinks = None
        self.head_w = 1.0

    # ------------------------------------------------------------------ locomoción
    def _close(self, t):
        # extiende la última pose de parado hasta t
        last = self.segs[-1]
        if isinstance(last, Stand):
            last.t1 = t
        else:
            self.segs.append(Stand(last.t1, t, self.cur_pos, self.cur_yaw, self.sep))

    def stand_until(self, t):
        self._close(t)
        self.cur_t = t

    def turn(self, t0, t1, yaw):
        self._close(t0)
        tr = Turn(t0, t1, self.cur_pos, self.cur_yaw, yaw, self.sep)
        self.segs.append(tr)
        self.cur_yaw = tr.yaw1
        self.segs.append(Stand(t1, t1, self.cur_pos, self.cur_yaw, self.sep))
        self.cur_t = t1
        return t1

    def side_step(self, t0, t1, pos):
        self._close(t0)
        self.segs.append(SideStep(t0, t1, self.cur_pos, pos, self.cur_yaw, self.sep))
        self.cur_pos = np.array(pos, float)
        self.segs.append(Stand(t1, t1, self.cur_pos, self.cur_yaw, self.sep))
        self.cur_t = t1
        return t1

    def face_dir(self, t0, t1, target):
        d = np.array(target[:2]) - self.cur_pos
        return self.turn(t0, t1, yaw_from_dir(d))

    def walk(self, t0, t1, pts, step=0.68):
        pts = [tuple(self.cur_pos)] + [tuple(p[:2]) for p in pts]
        d0 = np.array(pts[1]) - np.array(pts[0])
        y0 = yaw_from_dir(d0)
        if abs(turn_angle(self.cur_yaw, y0)) > 0.2:
            t0 = self.turn(t0, t0 + 0.55, y0) - 0.08
        self._close(t0)
        w = Walk(pts, t0, t1, step=step, foot_sep=self.sep)
        self.segs.append(WalkSeg(w))
        end = np.array(pts[-1], float)
        self.cur_pos = end
        self.cur_yaw = yaw_from_dir(w.path.tangent(w.S))
        self.segs.append(Stand(t1 + 0.4, t1 + 0.4, end, self.cur_yaw, self.sep))
        self.cur_t = t1 + 0.4
        return w

    def _seg(self, t):
        for s in reversed(self.segs):
            if s.t0 <= t:
                if t <= s.t1 or s is self.segs[-1]:
                    return s
                # entre segmentos: el siguiente aún no empezó → quedarse en el final de s
                return s
        return self.segs[0]

    # ------------------------------------------------------------------ brazos y manos
    def hand(self, side, t, state):
        """state: 'rest' | ('world', pos, finger_dir, palm_dir) | callable(t)->tuple."""
        self.hands[side].append((t, state))
        self.hands[side].sort(key=lambda k: k[0])

    def hand_pose(self, side, t, weights):
        self.poses[side].append((t, dict(weights)))
        self.poses[side].sort(key=lambda k: k[0])

    def look_at(self, t, target, head=1.0):
        """target: punto mundo, 'fwd' (al frente) o callable(t)."""
        self.looks.append((t, target, head))
        self.looks.sort(key=lambda k: k[0])

    def expression(self, t, name_or_dict, w=1.0):
        d = EXPRESSIONS[name_or_dict] if isinstance(name_or_dict, str) else name_or_dict
        self.faces.append((t, {k: v * w for k, v in d.items()}))
        self.faces.sort(key=lambda k: k[0])

    def attach(self, obj, side, t_grab, t_release, offset=None):
        self.attachments.append(dict(obj=obj, side=side, t0=t_grab, t1=t_release, offset=offset))

    # ------------------------------------------------------------------ evaluación
    def body_at(self, t):
        s = self._seg(t)
        p, yaw, bob, sway, amp, phase = s.body(min(t, s.t1) if not isinstance(s, WalkSeg) else t)
        return np.array(p), yaw, bob, sway, amp, phase

    def torso_rot(self, t, yaw):
        return (Quaternion((0, 0, 1), yaw + self.twist(t)) @ Quaternion((1, 0, 0), self.lean(t)))

    def shoulder_world(self, side, t, pos, yaw, bob):
        A = self.a
        R0 = A.rest['root'].translation
        sh = A.rest['upperarm01.' + side].translation
        sp = A.rest['spine05'].translation
        hip = Vector((pos[0], pos[1], R0.z + bob - self.crouch(t)))
        q = self.torso_rot(t, yaw)
        # el torso pivota en spine05
        v = q @ (sh - sp) + Quaternion((0, 0, 1), yaw) @ (sp - R0)
        return A.mw @ (hip + v) if False else hip + v

    def rest_hand(self, side, t, pos, yaw, bob, amp, phase, foot_fw):
        A = self.a
        arm_len = (A.rest['lowerarm01.' + side].translation - A.rest['upperarm01.' + side].translation).length + \
            (A.rest['wrist.' + side].translation - A.rest['lowerarm01.' + side].translation).length
        sh = self.shoulder_world(side, t, pos, yaw, bob)
        s = 1 if side == 'L' else -1
        q = self.torso_rot(t, yaw)
        breath = 0.004 * math.sin(t * 2 * math.pi * 0.23)
        swing = -foot_fw * 0.45 * amp
        local = Vector((s * 0.075, -0.035 + swing, -arm_len * 0.975 + abs(swing) * 0.2 + breath))
        p = sh + q @ local
        fdir = q @ Vector((s * 0.02, -0.18 + swing * 0.6, -1.0))
        pdir = q @ Vector((-s * 1.0, 0.45, 0.0))
        return p, fdir, pdir

    def _interp_states(self, keys, t, rest_fn):
        if not keys:
            return rest_fn()

        def resolve(st):
            if st == 'rest':
                return rest_fn()
            if callable(st):
                return st(t)
            return st[1], st[2], st[3]

        if t <= keys[0][0]:
            return resolve(keys[0][1])
        if t >= keys[-1][0]:
            return resolve(keys[-1][1])
        for (t0, s0), (t1, s1) in zip(keys[:-1], keys[1:]):
            if t0 <= t <= t1:
                u = ease_io((t - t0) / max(t1 - t0, 1e-6))
                a = resolve(s0)
                b = resolve(s1)
                p = Vector(a[0]).lerp(Vector(b[0]), u)
                # arco: levantar levemente la mano en transiciones largas
                dist = (Vector(a[0]) - Vector(b[0])).length
                p.z += math.sin(math.pi * u) * min(dist * 0.15, 0.05)
                f = Vector(a[1]).normalized().slerp(Vector(b[1]).normalized(), u) if hasattr(Vector, 'slerp') else Vector(a[1]).lerp(Vector(b[1]), u)
                pd = Vector(a[2]).normalized().lerp(Vector(b[2]).normalized(), u)
                return p, f, pd
        return resolve(keys[-1][1])

    def _interp_dicts(self, keys, t, default):
        if not keys:
            return default
        if t <= keys[0][0]:
            return keys[0][1]
        if t >= keys[-1][0]:
            return keys[-1][1]
        for (t0, d0), (t1, d1) in zip(keys[:-1], keys[1:]):
            if t0 <= t <= t1:
                u = ease_io((t - t0) / max(t1 - t0, 1e-6))
                out = {}
                for k in set(d0) | set(d1):
                    out[k] = d0.get(k, 0.0) * (1 - u) + d1.get(k, 0.0) * u
                return out
        return keys[-1][1]

    def _look(self, t, head_pos, yaw):
        fwd = head_pos + Vector((math.sin(yaw), -math.cos(yaw), -0.08)) * 2.0
        keys = self.looks
        if not keys:
            return fwd, 1.0

        def res(tg):
            if tg == 'fwd' or tg is None:
                return fwd
            if callable(tg):
                return Vector(tg(t))
            return Vector(tg)

        if t <= keys[0][0]:
            return res(keys[0][1]), keys[0][2]
        if t >= keys[-1][0]:
            return res(keys[-1][1]), keys[-1][2]
        for (t0, a, ha), (t1, b, hb) in zip(keys[:-1], keys[1:]):
            if t0 <= t <= t1:
                u = ease_io((t - t0) / max(t1 - t0, 1e-6), 2.2)
                pa, pb = res(a), res(b)
                # interpolar en dirección (desde la cabeza) para un giro natural
                da = (pa - head_pos)
                db = (pb - head_pos)
                la, lb = da.length, db.length
                d = da.normalized().slerp(db.normalized(), u) if hasattr(da, 'slerp') else da.normalized().lerp(db.normalized(), u).normalized()
                return head_pos + d * (la + (lb - la) * u), ha + (hb - ha) * u
        return res(keys[-1][1]), keys[-1][2]

    def _blink(self, t):
        if self.blinks is None:
            self.blinks = []
            tt = 0.8
            while tt < 4000:
                self.blinks.append(tt)
                tt += self.rnd.uniform(2.2, 5.0)
        for b in self.blinks:
            if b - 0.02 <= t <= b + 0.2:
                u = (t - b) / 0.2
                return max(0.0, math.sin(math.pi * min(max(u, 0), 1)) ** 0.7)
            if b > t + 1:
                break
        return 0.0

    def hand_matrix_world(self, side, t, cache):
        return cache[(side, t)]

    def bake(self, f0, f1, fps=30.0, time_offset=0.0, timemap=None):
        """Evalúa y escribe la animación para los frames f0..f1 (tiempo t = (f - f0)/fps + offset).

        timemap(f) -> t permite cámara lenta (tiempo de historia más lento que el real)."""
        self.timemap = timemap
        A = self.a
        R0 = A.rest['root'].translation
        head_rest = A.rest['head'].translation
        hand_cache = {}
        for f in range(f0, f1 + 1):
            t = timemap(f) if timemap else (f - f0) / fps + time_offset
            pos, yaw, bob, sway, amp, phase = self.body_at(t)
            seg = self._seg(t)
            feet = {}
            for side in 'LR':
                fp, fy, fpitch = seg.foot(side, t)
                feet[side] = (fp, fy, fpitch)
            # cadera ligeramente hacia el pie de apoyo + respiración + deriva de peso al estar quieto
            idle = (1 - amp)
            weight_shift = 0.012 * math.sin(t * 2 * math.pi * 0.11) * idle + self.hip_shift(t)
            left = Vector((math.cos(yaw), math.sin(yaw), 0))
            hip_z = R0.z - 0.012 + bob - self.crouch(t)
            hip = Vector((pos[0], pos[1], hip_z)) + left * (sway + weight_shift)
            # pelvis: inclinar levemente con el avance
            A.set_root(f, A.mw @ hip if False else hip, yaw + 0.06 * math.sin(phase) * amp,
                       lean=0.03 * amp, sway=0.03 * math.sin(phase) * amp)
            # pies
            for side in 'LR':
                fp, fy, fpitch = feet[side]
                ank_h = A.rest['foot.' + side].translation.z
                p = Vector((fp[0], fp[1], fp[2] + ank_h))
                # pivote de talón/punta aproximado
                if fpitch > 0:
                    p.z += 0.09 * math.sin(fpitch)
                A.set_ik_foot(f, side, p, fy, -fpitch)
                # polo de rodilla: adelante del pie
                fwdv = Vector((math.sin(fy), -math.cos(fy), 0))
                A.set_pole(f, 'pole_leg.' + side, Vector((fp[0], fp[1], 0.5)) + fwdv * 0.8)
            # columna: inclinación / torsión distribuidas + respiración + contra-rotación al caminar
            lean = self.lean(t)
            twist = self.twist(t) - 0.08 * math.sin(phase) * amp
            breath = math.radians(0.7) * math.sin(t * 2 * math.pi * 0.23)
            shares = {'spine05': 0.15, 'spine04': 0.2, 'spine03': 0.25, 'spine02': 0.2, 'spine01': 0.2}
            for bn, w in shares.items():
                q = Quaternion((0, 0, 1), twist * w) @ Quaternion((1, 0, 0), lean * w + (breath if bn in ('spine02', 'spine01') else 0))
                A.set_world_rot(f, bn, q)
            # hombros relajados
            for side in 'LR':
                A.set_world_rot(f, 'clavicle.' + side, Quaternion())
            # cabeza: mirar objetivo
            q_torso = Quaternion((0, 0, 1), yaw + twist + 0.06 * math.sin(phase) * amp) @ Quaternion((1, 0, 0), lean)
            head_pos = hip + q_torso @ (head_rest - R0)
            tgt, hw = self._look(t, head_pos, yaw)
            d_world = (tgt - head_pos).normalized()
            d_local = q_torso.inverted() @ d_world
            # giro natural: yaw alrededor del eje vertical y luego cabeceo (sin rolido)
            hyaw = math.atan2(d_local.x, -d_local.y)
            hpitch = math.atan2(d_local.z, math.hypot(d_local.x, d_local.y))
            hyaw = max(-1.3, min(1.3, hyaw)) * hw * self.head_w
            hpitch = max(-0.75, min(0.6, hpitch)) * hw * self.head_w
            rot = Quaternion((0, 0, 1), hyaw) @ Quaternion((1, 0, 0), -hpitch)
            for bn, w in (('neck01', 0.15), ('neck02', 0.15), ('neck03', 0.2), ('head', 0.5)):
                A.set_world_rot(f, bn, Quaternion().slerp(rot, w))
            A.set_look(f, A.mw @ tgt if False else tgt)
            # manos
            for side in 'LR':
                foot_fw = 0.0
                if amp > 0:
                    fwdv = Vector((math.sin(yaw), -math.cos(yaw), 0))
                    foot_fw = (Vector(feet[side][0]) - Vector((pos[0], pos[1], 0))).dot(fwdv)
                rest = lambda side=side, foot_fw=foot_fw: self.rest_hand(side, t, pos, yaw, bob, amp, phase, foot_fw)
                p, fd, pd = self._interp_states(self.hands[side], t, rest)
                hand_cache[(side, f)] = (Vector(p), Vector(fd), Vector(pd))
                A.set_ik_hand(f, side, p, fd, pd)
                sh = self.shoulder_world(side, t, pos, yaw, bob)
                s = 1 if side == 'L' else -1
                qy = Quaternion((0, 0, 1), yaw)
                A.set_pole(f, 'pole_arm.' + side, sh + qy @ Vector((s * 0.25, 0.6, -0.35)))
                pw = self._interp_dicts(self.poses[side], t, {'relaxed': 1.0})
                A.set_hand(f, side, pw)
            # cara
            fw = dict(self._interp_dicts(self.faces, t, {}))
            bl = self._blink(t)
            if bl > 0:
                fw['LeftUpperLidClosed'] = max(fw.get('LeftUpperLidClosed', 0), bl)
                fw['RightUpperLidClosed'] = max(fw.get('RightUpperLidClosed', 0), bl)
            A.set_face(f, fw)
        A.write()
        self._bake_attachments(f0, f1, fps, time_offset, hand_cache)
        return hand_cache

    def wrist_world(self, side, frame, cache):
        p, fd, pd = cache[(side, frame)]
        A = self.a
        B = A.rest3['wrist.' + side]
        y_l = Vector((0, 1, 0))
        pn_l = B.transposed() @ A.palm_n[side]
        q_l = (pn_l - y_l * pn_l.dot(y_l)).normalized()
        F = fd.normalized()
        P = (pd - F * pd.dot(F)).normalized()
        src = Matrix((y_l, q_l, y_l.cross(q_l))).transposed()
        dst = Matrix((F, P, F.cross(P))).transposed()
        R = dst @ src.inverted()
        return Matrix.Translation(p) @ R.to_4x4()

    def _frame_of(self, t, f0, f1, fps, toff):
        tm = getattr(self, 'timemap', None)
        if tm is None:
            return f0 + int(round((t - toff) * fps))
        for f in range(f0, f1 + 1):
            if tm(f) >= t - 1e-6:
                return f
        return f1 + 1

    def _bake_attachments(self, f0, f1, fps, toff, cache):
        from anim import KeyBuffer
        for at in self.attachments:
            ob = at['obj']
            kb = KeyBuffer(ob)
            fa = self._frame_of(at['t0'], f0, f1, fps, toff)
            fb = self._frame_of(at['t1'], f0, f1, fps, toff)
            fa = max(fa, f0)
            fb = min(fb, f1)
            if fa > f1 or fb < f0:
                continue
            bpy.context.scene.frame_set(fa)
            ob_m = ob.matrix_world.copy()
            W = self.wrist_world(at['side'], fa, cache)
            off = at['offset'] if at['offset'] is not None else W.inverted() @ ob_m
            ob.rotation_mode = 'QUATERNION'
            prev = None
            for f in range(fa, fb + 1):
                M = self.wrist_world(at['side'], f, cache) @ off
                loc, q, sc = M.decompose()
                if prev is not None and prev.dot(q) < 0:
                    q.negate()
                prev = q
                kb.key_vec('location', f, loc)
                kb.key_vec('rotation_quaternion', f, q)
            kb.write()
