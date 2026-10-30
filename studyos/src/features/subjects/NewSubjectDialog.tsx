import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input, Modal, cx } from '@/components/ui';
import { db, type Subject } from '@/lib/db';
import { newId } from '@/lib/ids';
import { SUBJECT_ICONS, SUBJECT_PRESETS, SUBJECT_STYLES, SubjectGlyph, subjectStyle } from '@/lib/subjects';
import { toast } from '@/stores/toast';

export function NewSubjectDialog({ open, onClose, edit }: { open: boolean; onClose: () => void; edit?: Subject }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [icon, setIcon] = useState<string>('book');
  const [category, setCategory] = useState('');
  useEffect(() => {
    if (open) {
      setName(edit?.name ?? '');
      setColor(edit?.color ?? 'blue');
      setIcon(edit?.icon ?? 'book');
      setCategory(edit?.category ?? '');
    }
  }, [open, edit]);
  const save = async () => {
    const now = Date.now();
    if (edit) {
      await db.subjects.update(edit.id, { name: name.trim(), color, icon, category: category.trim(), updatedAt: now });
      toast.ok('Materia actualizada');
      onClose();
      return;
    }
    const id = newId();
    await db.subjects.add({ id, name: name.trim(), color, icon, category: category.trim(), createdAt: now, updatedAt: now });
    toast.ok(`Materia «${name.trim()}» creada`);
    onClose();
    nav(`/subjects/${id}`);
  };
  const st = subjectStyle(color);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? 'Editar materia' : 'Nueva materia'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            {edit ? 'Guardar' : 'Crear materia'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!edit && (
          <div className="flex flex-wrap gap-1.5">
            {SUBJECT_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  setName(p.name);
                  setColor(p.color);
                  setIcon(p.icon);
                  setCategory(p.category);
                }}
                className="h-8 px-3 rounded-full border border-line text-xs text-muted hover:text-ink"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3 items-end">
          <div className="grid place-items-center size-[72px] rounded-xl text-white shrink-0" style={{ background: st.bg, border: `1px solid ${st.border}` }}>
            <SubjectGlyph icon={icon} className="size-8" />
          </div>
          <Field label="Nombre" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Química orgánica" autoFocus />
          </Field>
        </div>
        <Field label="Categoría">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej.: Ciencias naturales, 2.º año, Facultad…" />
        </Field>
        <div>
          <div className="text-xs font-medium text-muted mb-1.5">Color</div>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_STYLES.map((s) => (
              <button key={s.id} onClick={() => setColor(s.id)} aria-label={s.label} className={cx('size-9 rounded-full border-2', color === s.id ? 'border-white' : 'border-transparent')} style={{ background: s.bg }} />
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted mb-1.5">Ícono</div>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_ICONS.map((i) => (
              <button key={i} onClick={() => setIcon(i)} aria-label={`Ícono ${i}`} className={cx('grid place-items-center size-10 rounded-xl border', icon === i ? 'nav-active' : 'border-line text-muted')}>
                <SubjectGlyph icon={i} className="size-5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
