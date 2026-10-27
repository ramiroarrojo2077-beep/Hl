"""Carga de assets MakeHuman (CC0): malla base hm08, targets, esqueleto, pesos y proxies.

Todo en numpy, sin dependencia de bpy. Las coordenadas se devuelven ya convertidas
al sistema de Blender (Z arriba, el personaje mira hacia -Y, metros).
"""
import json
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MH_DIR = os.path.join(HERE, '..', 'assets', 'makehuman')


def mh_to_blender(co):
    """MakeHuman: Y arriba, decímetros, mira a +Z  ->  Blender: Z arriba, metros, mira a -Y."""
    co = np.asarray(co, dtype=np.float64)
    out = np.empty_like(co)
    out[..., 0] = co[..., 0]
    out[..., 1] = -co[..., 2]
    out[..., 2] = co[..., 1]
    return out * 0.1


def load_obj(path):
    verts, uvs, faces, face_uvs, face_groups = [], [], [], [], []
    group = None
    with open(path) as fh:
        for line in fh:
            if line.startswith('v '):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                uvs.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '):
                group = line.split()[1]
            elif line.startswith('f '):
                vi, ti = [], []
                for tok in line.split()[1:]:
                    parts = tok.split('/')
                    vi.append(int(parts[0]) - 1)
                    ti.append(int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1)
                faces.append(vi)
                face_uvs.append(ti)
                face_groups.append(group)
    return (np.array(verts), np.array(uvs) if uvs else None, faces, face_uvs, face_groups)


def load_target(path):
    idx, delta = [], []
    with open(path) as fh:
        for line in fh:
            if not line.strip() or line[0] == '#':
                continue
            p = line.split()
            idx.append(int(p[0]))
            delta.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, dtype=np.int64), np.array(delta).reshape(-1, 3)


def _age_weights(age):
    keys = [('baby', 0.0), ('child', 0.1875), ('young', 0.5), ('old', 1.0)]
    out = {}
    for (k0, a0), (k1, a1) in zip(keys[:-1], keys[1:]):
        if a0 <= age <= a1:
            t = (age - a0) / (a1 - a0)
            out[k0] = 1 - t
            out[k1] = t
            break
    return {k: v for k, v in out.items() if v > 1e-6}


def _tri_weights(v, names):
    lo, mid, hi = names
    if v < 0.5:
        return {k: w for k, w in ((lo, (0.5 - v) * 2), (mid, v * 2)) if w > 1e-6}
    return {k: w for k, w in ((mid, (1 - v) * 2), (hi, (v - 0.5) * 2)) if w > 1e-6}


def macro_targets(age=0.63, muscle=0.55, weight=0.5, height=0.6, proportions=0.7,
                  races=(('caucasian', 0.7), ('african', 0.1), ('asian', 0.2))):
    """Pesos de los targets macro (personaje masculino). Réplica simplificada de MacroModifier."""
    ages = _age_weights(age)
    musc = _tri_weights(muscle, ('minmuscle', 'averagemuscle', 'maxmuscle'))
    wght = _tri_weights(weight, ('minweight', 'averageweight', 'maxweight'))
    res = {}
    for race, rw in races:
        for a, aw in ages.items():
            res['%s-male-%s.target' % (race, a)] = rw * aw
    for a, aw in ages.items():
        for m, mw in musc.items():
            for w, ww in wght.items():
                base = 'male-%s-%s-%s' % (a, m, w)
                res['universal-%s.target' % base] = aw * mw * ww
                if height > 0.5:
                    res['%s-maxheight.target' % base] = aw * mw * ww * (height - 0.5) * 2
                if proportions > 0.5:
                    res['%s-idealproportions.target' % base] = aw * mw * ww * (proportions - 0.5) * 2
    return res


class Human:
    """Malla base con targets aplicados, en coordenadas MakeHuman (dm, Y arriba)."""

    def __init__(self, targets=None, extra_targets=None):
        self.base_co, self.uvs, self.faces, self.face_uvs, self.face_groups = load_obj(
            os.path.join(MH_DIR, 'base.obj'))
        self.co = self.base_co.copy()
        tdir = os.path.join(MH_DIR, 'targets')
        for name, w in (targets or macro_targets()).items():
            p = os.path.join(tdir, name)
            if w <= 0 or not os.path.exists(p):
                continue
            idx, d = load_target(p)
            self.co[idx] += w * d
        for path, w in (extra_targets or {}).items():
            idx, d = load_target(path)
            self.co[idx] += w * d
        skel = json.load(open(os.path.join(MH_DIR, 'default.mhskel')))
        self.skel = skel
        self.joint_idx = {k: np.array(v) for k, v in skel['joints'].items()}

    # --- esqueleto -----------------------------------------------------
    def joint(self, name):
        return self.co[self.joint_idx[name]].mean(axis=0)

    def bones(self):
        """Lista de huesos con head/tail/normal en coordenadas Blender (sin offset de suelo)."""
        planes = self.skel['planes']
        out = []
        for name, b in self.skel['bones'].items():
            head = self.joint(b['head'])
            tail = self.joint(b['tail'])
            rp = b.get('rotation_plane')
            normals = []
            for pn in ([rp] if isinstance(rp, str) else (rp or [])):
                if pn not in planes:
                    continue
                p1, p2, p3 = (self.joint(j) for j in planes[pn])
                pv = p2 - p1
                yv = p3 - p2
                if np.linalg.norm(pv) < 1e-9 or np.linalg.norm(yv) < 1e-9:
                    continue
                n = np.cross(yv / np.linalg.norm(yv), pv / np.linalg.norm(pv))
                if np.linalg.norm(n) > 1e-6:
                    normals.append(n / np.linalg.norm(n))
            normal = np.mean(normals, axis=0) if normals else np.array([0.0, 1.0, 0.0])
            out.append(dict(name=name, parent=b['parent'], head=mh_to_blender(head),
                            tail=mh_to_blender(tail), normal=mh_to_blender(normal) * 10.0))
        return out

    def weights(self):
        w = json.load(open(os.path.join(MH_DIR, 'default_weights.mhw')))['weights']
        return {bone: np.array(lst) for bone, lst in w.items()}

    # --- proxies (.mhclo) ---------------------------------------------
    def fit_proxy(self, mhclo_path):
        ref, wts, offs = [], [], []
        scales = {}
        obj_file = None
        in_verts = False
        with open(mhclo_path) as fh:
            for line in fh:
                p = line.split()
                if not p or p[0].startswith('#'):
                    continue
                if in_verts:
                    if len(p) == 9:
                        ref.append([int(x) for x in p[:3]])
                        wts.append([float(x) for x in p[3:6]])
                        offs.append([float(x) for x in p[6:9]])
                        continue
                    if len(p) == 1 and p[0].isdigit():
                        ref.append([int(p[0])] * 3)
                        wts.append([1.0, 0.0, 0.0])
                        offs.append([0.0, 0.0, 0.0])
                        continue
                    in_verts = False
                if p[0] == 'verts':
                    in_verts = True
                elif p[0] in ('x_scale', 'y_scale', 'z_scale'):
                    scales[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
                elif p[0] == 'obj_file':
                    obj_file = p[1]
        ref = np.array(ref)
        wts = np.array(wts)
        offs = np.array(offs)
        sc = np.ones(3)
        for ax, i in (('x', 0), ('y', 1), ('z', 2)):
            if ax in scales:
                a, b, d = scales[ax]
                sc[i] = abs(self.co[a, i] - self.co[b, i]) / d
        co = (self.co[ref[:, 0]] * wts[:, 0, None] + self.co[ref[:, 1]] * wts[:, 1, None]
              + self.co[ref[:, 2]] * wts[:, 2, None] + offs * sc)
        pv, puv, pf, pfuv, pg = load_obj(os.path.join(os.path.dirname(mhclo_path), obj_file))
        return co, puv, pf, pfuv, pg


def parse_bvh(path):
    """Parser BVH mínimo: devuelve joints (nombre, padre, offset, canales) y frames (lista de arrays)."""
    joints, stack, order = [], [], []
    frames = []
    with open(path) as fh:
        lines = fh.read().split('\n')
    i = 0
    while i < len(lines):
        t = lines[i].split()
        if not t:
            i += 1
            continue
        if t[0] in ('ROOT', 'JOINT'):
            joints.append(dict(name=t[1], parent=stack[-1] if stack else None, offset=None, channels=[]))
            order.append(len(joints) - 1)
        elif t[0] == 'End':
            joints.append(dict(name=None, parent=stack[-1], offset=None, channels=[]))
        elif t[0] == '{':
            stack.append(len(joints) - 1)
        elif t[0] == '}':
            stack.pop()
        elif t[0] == 'OFFSET':
            joints[stack[-1]]['offset'] = np.array([float(x) for x in t[1:4]])
        elif t[0] == 'CHANNELS':
            joints[stack[-1]]['channels'] = t[2:]
        elif t[0] == 'MOTION':
            i += 3
            while i < len(lines):
                if lines[i].strip():
                    frames.append(np.array([float(x) for x in lines[i].split()]))
                i += 1
            break
        i += 1
    return joints, frames
