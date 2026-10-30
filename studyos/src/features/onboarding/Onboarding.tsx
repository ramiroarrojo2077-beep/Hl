import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { useSettings } from '@/stores/settings';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { SUBJECT_PRESETS } from '@/lib/subjects';
import { cx } from '@/components/ui';

const LEVELS = ['Primario', 'Secundario', 'Terciario', 'Universitario', 'Posgrado', 'Autodidacta'];

export function Onboarding() {
  const { s, update } = useSettings();
  const nav = useNavigate();
  const [name, setName] = useState(s.profile.name);
  const [level, setLevel] = useState(s.profile.level);
  const [picked, setPicked] = useState<string[]>(['Matemática', 'Física', 'Química', 'Biología']);
  const finish = async (goAi: boolean) => {
    const now = Date.now();
    const existing = new Set((await db.subjects.toArray()).map((x) => x.name));
    await db.subjects.bulkAdd(
      SUBJECT_PRESETS.filter((p) => picked.includes(p.name) && !existing.has(p.name)).map((p) => ({ id: newId(), name: p.name, color: p.color, icon: p.icon, category: p.category, createdAt: now, updatedAt: now })),
    );
    await update((x) => {
      x.onboarded = true;
      x.profile.name = name.trim();
      x.profile.level = level;
    });
    if (goAi) nav('/settings#ia');
  };
  return (
    <Modal
      open
      onClose={() => finish(false)}
      title="Bienvenido a StudyOS AI"
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            Empezar sin IA
          </Button>
          <Button variant="primary" onClick={() => finish(true)}>
            Configurar la IA
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Tus datos se guardan solo en este dispositivo. Podés exportarlos cuando quieras desde Configuración.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="¿Cómo te llamás?">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" autoFocus />
          </Field>
          <Field label="Nivel educativo">
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <div className="text-xs font-medium text-muted mb-2">Elegí tus materias (después podés crear otras)</div>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_PRESETS.map((p) => {
              const on = picked.includes(p.name);
              return (
                <button key={p.name} onClick={() => setPicked((v) => (on ? v.filter((x) => x !== p.name) : [...v, p.name]))} className={cx('h-9 px-3 rounded-full border text-sm transition', on ? 'nav-active text-white' : 'border-line text-muted hover:text-ink')}>
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-white/[.02] p-3 text-[13px] text-[#cbd5e1] leading-relaxed">
          <b className="text-ink">Sin IA funcionan:</b> materias, biblioteca con OCR, flashcards con repetición espaciada, exámenes y tareas ya creados, calendario y planificador, modo Focus, pizarra, laboratorio 3D y estadísticas.
          <br />
          <b className="text-ink">Con IA</b> (Gemini tiene plan gratuito; también Claude, OpenAI, servicios compatibles u Ollama local): profesor virtual, resúmenes, generación de tareas, exámenes, flashcards, mapas y videos.
        </div>
      </div>
    </Modal>
  );
}
