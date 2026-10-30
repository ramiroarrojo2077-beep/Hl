import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileUp, ClipboardPaste, Camera } from 'lucide-react';
import { Button, Field, Input, Modal, Segmented, Select, Textarea, Notice } from '@/components/ui';
import { db, logActivity } from '@/lib/db';
import { ACCEPT, MAX_FILE_MB, importDocument } from '@/import';
import { runJob } from '@/stores/jobs';
import { aiConfigured, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { fmtBytes } from '@/lib/format';

export function ImportDialog({ open, onClose, subjectId }: { open: boolean; onClose: () => void; subjectId?: string }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const s = useSettings((x) => x.s);
  const nav = useNavigate();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(subjectId ?? '');
  const [ocr, setOcr] = useState<'local' | 'ai' | 'off'>('local');
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const start = () => {
    const sid = subject || undefined;
    const list = mode === 'file' ? files : [null];
    for (const f of list) {
      const label = f ? f.name : title || 'Texto pegado';
      runJob(
        `Importando «${label}»`,
        async ({ signal, progress }) => {
          const doc = await importDocument(f ? { file: f } : { text }, { subjectId: sid, title: f ? undefined : title, ocrMode: ocr, signal, onProgress: progress });
          await logActivity({ type: 'import', title: `Importaste «${doc.title}»`, refId: doc.id, route: `/library/${doc.id}`, subjectId: sid });
          if (doc.status === 'error') throw new Error(doc.error ?? 'No se pudo leer el documento');
          if (doc.status === 'partial') toast.info(`«${doc.title}» se importó con avisos: revisá las páginas sin texto.`);
          return doc;
        },
        { route: (d) => `/library/${d.id}` },
      );
    }
    if (mode === 'paste' || files.length === 1) toast.info('La importación sigue en segundo plano. Podés seguir usando la app.');
    setFiles([]);
    setText('');
    setTitle('');
    onClose();
    if (list.length > 1) nav('/library');
  };

  const pickFiles = (fl: FileList | null) => {
    if (!fl) return;
    const arr = Array.from(fl);
    const big = arr.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (big.length) toast.error(`Algunos archivos superan ${MAX_FILE_MB} MB y no se agregaron.`);
    setFiles((cur) => [...cur, ...arr.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024)]);
  };

  const ready = mode === 'file' ? files.length > 0 : text.trim().length > 20;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Subir material de estudio"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!ready} onClick={start}>
            Importar {mode === 'file' && files.length > 1 ? `${files.length} archivos` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'file', label: 'Archivo o foto' }, { value: 'paste', label: 'Pegar texto' }]} />
        {mode === 'file' ? (
          <>
            <div
              className="rounded-2xl border-2 border-dashed border-line-strong p-6 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFiles(e.dataTransfer.files);
              }}
            >
              <FileUp className="size-7 mx-auto text-[#8ea2ff]" />
              <p className="text-sm mt-2">PDF, DOCX, PPTX, TXT, JPG o PNG (hasta {MAX_FILE_MB} MB)</p>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                <Button variant="secondary" onClick={() => fileRef.current?.click()} icon={<FileUp className="size-4" />}>
                  Elegir archivos
                </Button>
                <Button variant="secondary" onClick={() => camRef.current?.click()} icon={<Camera className="size-4" />}>
                  Sacar foto
                </Button>
              </div>
              <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => pickFiles(e.target.files)} />
              <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickFiles(e.target.files)} />
            </div>
            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-sm tile px-3 py-2">
                    <span className="truncate">{f.name}</span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted">{fmtBytes(f.size)}</span>
                      <button className="text-xs text-bad" onClick={() => setFiles((v) => v.filter((_, j) => j !== i))}>
                        Quitar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Field label="Reconocimiento de texto (para fotos y PDF escaneados)">
              <Select value={ocr} onChange={(e) => setOcr(e.target.value as typeof ocr)}>
                <option value="local">OCR en el dispositivo (sin conexión, español e inglés)</option>
                <option value="ai" disabled={!aiConfigured(s)}>
                  OCR con IA (más preciso con letra manuscrita){aiConfigured(s) ? '' : ' — requiere IA configurada'}
                </option>
                <option value="off">Sin OCR</option>
              </Select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Título">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Apuntes de la clase del martes" />
            </Field>
            <Field label="Texto" hint="Podés usar títulos con # para separar secciones.">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-48" placeholder="Pegá acá tus apuntes…" />
            </Field>
          </>
        )}
        <Field label="Materia">
          <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Sin materia</option>
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Notice>
          <span className="inline-flex items-center gap-1.5">
            <ClipboardPaste className="size-3.5" /> El archivo original queda guardado en el dispositivo y cada explicación generada cita la página de origen.
          </span>
        </Notice>
      </div>
    </Modal>
  );
}
