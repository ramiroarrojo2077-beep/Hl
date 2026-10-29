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
        # un pie por vez (nunca los dos en el aire: si no, la cadera "salta")
        a, b = (0.0, 0.5) if side == first else (0.5, 1.0)
        v = min(max((u - a) / (b - a), 0), 1)
        lat = self.sep if side == 'L' else -self.sep

        def place(yaw):
            left = np.array([math.cos(yaw), math.sin(yaw)])
            return self.pos + left * lat

        p0 = place(self.yaw0)
        p1 = place(self.yaw1)
        ve = ease_io(v)
        p = _lerp(p0, p1, ve)
        # despegue mínimo: la pierna va recta y el pie pasa al ras gracias al talón de apoyo levantado
        z = 0.001 * math.sin(math.pi * v)
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
        a, b = (0.0, 0.5) if side == self.lead else (0.5, 1.0)
        v = min(max((u - a) / (b - a), 0), 1)
        left = np.array([math.cos(self.yaw), math.sin(self.yaw)])
        lat = self.sep if side == 'L' else -self.sep
        p = self.p0 + (self.p1 - self.p0) * ease_io(v) + left * lat
        return np.array([p[0], p[1], 0.001 * math.sin(math.pi * v)]), self.yaw, 0.0


class WalkSeg:
    def __init__(self, walk, hip_fwd=0.0, leg_len=0.95):
        self.w = walk
        self.t0, self.t1 = walk.t0, walk.t1 + 0.4
        # las articulaciones de la cadera están ~6 cm delante del centro de la pelvis: al caminar se
        # retrasa la pelvis esa distancia para que los pasos queden simétricos respecto de las caderas
        # (si no, la pierna de atrás siempre va más estirada y la de adelante apoya doblada)
        # ...pero el pie de atrás apoya con el talón levantado (tobillo más alto), así que necesita un poco
        # más de distancia horizontal: las caderas quedan algo adelante del punto medio entre los pies
        dz = 0.12 * math.sin(walk.TOE_OFF)
        self.hip_fwd = max(0.0, hip_fwd - leg_len * dz / max(walk.d, 0.2))

    def body(self, t):
        p, yaw, bob, sway, amp, phase = self.w.body_state(t)
        k = self.hip_fwd * smoothstep(0.0, 1.0, amp)
        p = np.array([p[0] - math.sin(yaw) * k, p[1] + math.cos(yaw) * k])
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
        self.benches = []
        self.max_head_down = -0.75   # cabeceo máximo hacia abajo (rad); el resto lo hacen los ojos
        self._seed_ph = random.Random(seed).uniform(0, 6.28)   # mesadas (x0, x1, y0, y1, z_sup) que la mano en reposo no debe atravesar
        self.poses = {'L': [], 'R': []}
        self.looks = []
        self.faces = []
        self.attachments = []
        self.extra = []
        self.rnd = random.Random(seed)
        self.blinks = None
        self.head_w = 1.0
        self._hip_dz = 0.0

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

    def walk(self, t0, t1, pts, step=0.56):
        # paso máximo acorde al largo de pierna (con pasos largos la pierna de atrás no llega al piso)
        step = min(step, 0.56)
        pts = [tuple(self.cur_pos)] + [tuple(p[:2]) for p in pts]
        d0 = np.array(pts[1]) - np.array(pts[0])
        y0 = yaw_from_dir(d0)
        if abs(turn_angle(self.cur_yaw, y0)) > 0.2:
            t0 = self.turn(t0, t0 + 0.55, y0) - 0.08
        self._close(t0)
        w = Walk(pts, t0, t1, step=step, foot_sep=self.sep)
        R = self.a.rest
        off = sum(((R['upperleg01.' + sd].translation - R['root'].translation) for sd in 'LR'), Vector()) / 2
        self.segs.append(WalkSeg(w, hip_fwd=max(0.0, -off.y), leg_len=self._leg_len('L')))
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

    @staticmethod
    def tip_to_wrist(side, tip, fdir, pdir):
        """Posición de muñeca para que la punta del índice (pose 'point') quede en 'tip'.
        Medido sobre el rig: la punta queda ~0.193 m a lo largo de los dedos, ~0.042 m hacia la palma y ~0.017 m de lado."""
        f = Vector(fdir).normalized()
        pn = Vector(pdir) - f * Vector(pdir).dot(f)
        pn = pn.normalized() if pn.length > 1e-6 else Vector((0, 0, -1))
        lat = f.cross(pn) * (0.017 if side == 'R' else -0.017)
        return Vector(tip) - f * 0.193 - pn * 0.042 - lat

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
        hip = Vector((pos[0], pos[1], R0.z + bob - self.crouch(t) + self._hip_dz))
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
        # el brazo cuelga por gravedad: sigue el giro del torso pero no su inclinación (al inclinarse
        # hacia adelante la mano queda delante de la cadera en lugar de meterse en la bata)
        q = Quaternion((0, 0, 1), yaw + self.twist(t))
        breath = 0.004 * math.sin(t * 2 * math.pi * 0.23)
        swing = -foot_fw * 0.45 * amp
        local = Vector((s * 0.06, -0.04 + swing, -arm_len * 0.965 + abs(swing) * 0.2 + breath))
        p = sh + q @ local
        fdir = q @ Vector((s * 0.03, -0.18 + swing * 0.6, -1.0))
        pdir = q @ Vector((-s * 1.0, 0.45, 0.0))
        for bench in self.benches:
            p = self._out_of_bench(p, fdir, pos, *bench)
        return p, fdir, pdir

    @staticmethod
    def _over_bench(p, fdir, pdir, curl, bx0, bx1, by0, by1, top, tol=0.006):
        """Si los dedos entrarían en la mesada (en una transición o apoyando la mano), la mano sube lo
        justo para que las puntas queden sobre la superficie."""
        lift = 0.0
        fn, pn = fdir.normalized(), pdir.normalized()
        for q in (p, p + fn * 0.10 + pn * curl * 0.5, p + fn * 0.19 + pn * curl):
            if bx0 < q.x < bx1 and by0 < q.y < by1:
                lift = max(lift, top - tol - q.z)
        return p + Vector((0.0, 0.0, lift)) if lift > 0 else p

    @staticmethod
    def _out_of_bench(p, fdir, pos, bx0, bx1, by0, by1, top, m=0.04):
        """Mano que cuelga al inclinarse sobre una mesada: queda del lado del personaje, sin meterse
        en el mueble (se corre hacia afuera del borde que mira al personaje)."""
        tip = p + fdir.normalized() * 0.17
        w = 1.0 - smoothstep(top - 0.02, top + 0.04, min(p.z, tip.z))
        if w <= 0.0:
            return p
        cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
        hx, hy = (bx1 - bx0) / 2, (by1 - by0) / 2
        dx, dy = pos[0] - cx, pos[1] - cy
        if abs(dy) / hy >= abs(dx) / hx:
            sg = 1.0 if dy > 0 else -1.0
            near = min(p.y, tip.y) if sg > 0 else max(p.y, tip.y)
            push = (cy + sg * (hy + m) - near) * sg
            if push > 0 and bx0 - m < p.x < bx1 + m:
                p = p + Vector((0.0, sg * push * w, 0.0))
        else:
            sg = 1.0 if dx > 0 else -1.0
            near = min(p.x, tip.x) if sg > 0 else max(p.x, tip.x)
            push = (cx + sg * (hx + m) - near) * sg
            if push > 0 and by0 - m < p.y < by1 + m:
                p = p + Vector((sg * push * w, 0.0, 0.0))
        return p

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

    def _interp_dicts(self, keys, t, default, blend=None):
        """blend: duración máxima de la transición; antes se mantiene la clave anterior (si no, una mano que
        sostiene algo se iba abriendo durante todo el intervalo hasta la próxima pose)."""
        if not keys:
            return default
        if t <= keys[0][0]:
            return keys[0][1]
        if t >= keys[-1][0]:
            return keys[-1][1]
        for (t0, d0), (t1, d1) in zip(keys[:-1], keys[1:]):
            if t0 <= t <= t1:
                if blend is not None:
                    t0 = max(t0, t1 - blend)
                    if t < t0:
                        return d0
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

    def _ankle_target(self, side, fp, fpitch):
        """Posición mundo del tobillo para el IK: pivota sobre el talón (pie hacia arriba) o sobre la punta (despegue)."""
        ank_h = self.a.rest['foot.' + side].translation.z
        p = Vector((fp[0], fp[1], fp[2] + ank_h))
        if fpitch > 0:
            p.z += 0.09 * math.sin(fpitch)
        elif fpitch < 0:
            p.z += 0.12 * math.sin(-fpitch)
        return p

    def _leg_len(self, side):
        R = self.a.rest
        return (R['lowerleg01.' + side].translation - R['upperleg01.' + side].translation).length + \
            (R['foot.' + side].translation - R['lowerleg01.' + side].translation).length

    def _walk_root_z(self, feet, hip_xy, q, z_pref, ext=0.9995):
        """Altura de la raíz al caminar: la más alta posible (pierna de apoyo recta) sin que ningún pie
        quede fuera del alcance de la pierna. Produce el sube y baja natural de la cadera.
        q: rotación real de la pelvis (giro + inclinación + balanceo), para ubicar bien las articulaciones."""
        R = self.a.rest
        R0 = R['root'].translation
        vals = [z_pref]
        for side in 'LR':
            fp, fy, fpitch = feet[side]
            p = self._ankle_target(side, fp, fpitch)
            off = q @ (R['upperleg01.' + side].translation - R0)
            hj = hip_xy + Vector((off.x, off.y, 0.0))
            dxy = math.hypot(p.x - hj.x, p.y - hj.y)
            Lm = self._leg_len(side) * ext
            # solo los pies apoyados limitan la cadera; en el vuelo el pie pasa con la pierna recta
            other = feet['R' if side == 'L' else 'L'][0][2]
            relax = 0.25 * smoothstep(0.0, 0.0005, fp[2]) * (1.0 - smoothstep(0.0, 0.0005, other))
            if dxy < Lm:
                vals.append(p.z + math.sqrt(Lm * Lm - dxy * dxy) - off.z + relax)
            else:
                vals.append(p.z - off.z + relax)
        k = 0.0006   # mínimo suave (sin quiebres)
        m = min(vals)
        return m - k * math.log(sum(math.exp(-(v - m) / k) for v in vals))

    def _heel_fit(self, feet, hip, q, ext=0.9995):
        """Pie apoyado con el talón levantado: si la pierna quedaría floja (rodilla doblada), bajar el talón
        lo justo para que llegue estirada. Así la pierna de atrás sigue recta en el doble apoyo."""
        R = self.a.rest
        R0 = R['root'].translation
        out = dict(feet)
        for side in 'LR':
            fp, fy, fpitch = feet[side]
            if fp[2] > 0.0 or fpitch >= 0.0:
                continue
            hj = hip + q @ (R['upperleg01.' + side].translation - R0)
            base = self._ankle_target(side, fp, 0.0)
            dxy = math.hypot(base.x - hj.x, base.y - hj.y)
            Lm = self._leg_len(side) * ext
            if dxy >= Lm:
                continue
            z_req = hj.z - math.sqrt(Lm * Lm - dxy * dxy)   # tobillo a esta altura = pierna justo estirada
            lift = 0.12 * math.sin(-fpitch)
            if base.z + lift > z_req:
                sp = min(max((z_req - base.z) / 0.12, 0.0), 1.0)
                out[side] = (fp, fy, -math.asin(sp))
        return out

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
            # piernas rectas: al caminar, el pie de apoyo levanta un poco el talón mientras la otra pierna
            # pasa (así la pierna que avanza no necesita doblar la rodilla para no rozar el piso)
            # (vale para caminata, giros y pasos laterales)
            for sd, ot in (('L', 'R'), ('R', 'L')):
                sw = min(max(feet[ot][0][2] / 0.0005, 0.0), 1.0)
                if feet[sd][0][2] <= 0.0 and sw > 0:
                    fp_, fy_, fpi_ = feet[sd]
                    feet[sd] = (fp_, fy_, min(fpi_, -0.11 * sw))
            # cadera a la altura de las piernas extendidas (antes quedaba 1-3 cm más baja y las rodillas
            # se veían dobladas, incluso parado); 'crouch' sigue doblando las rodillas a propósito
            # pelvis: inclinar levemente con el avance
            r_yaw, r_lean, r_sway = yaw + 0.06 * math.sin(phase) * amp, 0.03 * amp, 0.03 * math.sin(phase) * amp
            q_root = Quaternion((0, 0, 1), r_yaw) @ Quaternion((1, 0, 0), r_lean) @ Quaternion((0, 1, 0), r_sway)
            z_ext = self._walk_root_z(feet, Vector((hip.x, hip.y, 0.0)), q_root, R0.z + 0.05)
            hip.z = z_ext - self.crouch(t)
            self._hip_dz = hip.z - (R0.z + bob - self.crouch(t))
            feet = self._heel_fit(feet, hip, q_root)
            A.set_root(f, hip, r_yaw, lean=r_lean, sway=r_sway)
            # pies
            for side in 'LR':
                fp, fy, fpitch = feet[side]
                p = self._ankle_target(side, fp, fpitch)
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
            hpitch = max(self.max_head_down, min(0.6, hpitch)) * hw * self.head_w
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
                pw = self._interp_dicts(self.poses[side], t, {'relaxed': 1.0}, blend=0.45)
                if self.benches:
                    # cuánto bajan las puntas hacia el lado de la palma según la pose (relajada > puño > abierta/señalar)
                    tw_ = sum(pw.values()) or 1.0
                    curl = (0.04 * pw.get('relaxed', 0.0) + 0.02 * pw.get('grip', 0.0)) / tw_
                    for bench in self.benches:
                        p = self._over_bench(Vector(p), Vector(fd), Vector(pd), curl, *bench)
                hand_cache[(side, f)] = (Vector(p), Vector(fd), Vector(pd))
                A.set_ik_hand(f, side, p, fd, pd)
                sh = self.shoulder_world(side, t, pos, yaw, bob)
                s = 1 if side == 'L' else -1
                qy = Quaternion((0, 0, 1), yaw)
                A.set_pole(f, 'pole_arm.' + side, sh + qy @ Vector((s * 0.25, 0.6, -0.35)))
                A.set_hand(f, side, pw)
            # cara
            fw = dict(self._interp_dicts(self.faces, t, {}, blend=0.8))
            # cara viva: párpados abiertos por defecto y micro-movimientos suaves de cejas, labios y mejillas
            # (ruido lento con fases distintas; nunca queda una máscara rígida)
            for k, base_, amp_, fr_, ph in (('LeftUpperLidOpen', 0.4, 0.0, 0.0, 0.0), ('RightUpperLidOpen', 0.4, 0.0, 0.0, 0.0),
                                            ('LeftOuterBrowUp', 0.0, 0.12, 0.31, 0.0), ('RightOuterBrowUp', 0.0, 0.12, 0.31, 0.4),
                                            ('LeftInnerBrowUp', 0.0, 0.08, 0.23, 1.3), ('RightInnerBrowUp', 0.0, 0.08, 0.23, 1.5),
                                            ('MouthLeftPullUp', 0.0, 0.07, 0.17, 2.1), ('MouthRightPullUp', 0.0, 0.07, 0.17, 2.6),
                                            ('lowerLipUp', 0.0, 0.06, 0.41, 0.7), ('LeftCheekUp', 0.0, 0.05, 0.13, 3.3),
                                            ('RightCheekUp', 0.0, 0.05, 0.13, 3.5)):
                v = base_ + amp_ * max(0.0, math.sin(t * 2 * math.pi * fr_ + ph + self._seed_ph) * 0.6
                                       + math.sin(t * 2 * math.pi * fr_ * 2.7 + ph * 1.7) * 0.4)
                fw[k] = fw.get(k, 0.0) + v
            bl = self._blink(t)
            if bl > 0:
                for k in ('LeftUpperLidOpen', 'RightUpperLidOpen'):
                    fw[k] = fw.get(k, 0.0) * (1.0 - bl)
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
