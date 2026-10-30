import { useState } from 'react';
import { Lock } from 'lucide-react';
import { verifyPin } from '@/lib/pin';
import { useSettings } from '@/stores/settings';
import { Button, Input } from '@/components/ui';
import { Brand } from '@/components/layout/Brand';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { s } = useSettings();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const submit = async () => {
    setBusy(true);
    const ok = await verifyPin(pin, s.security.pinHash!, s.security.pinSalt!);
    setBusy(false);
    if (ok) onUnlock();
    else {
      setTries((t) => t + 1);
      setErr('PIN incorrecto.');
      setPin('');
    }
  };
  return (
    <div className="app-backdrop min-h-dvh grid place-items-center p-6">
      <form
        className="panel w-full max-w-sm p-6 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex justify-center mb-6">
          <Brand />
        </div>
        <Lock className="size-6 mx-auto text-[#8ea2ff] mb-3" />
        <h1 className="font-display font-semibold text-lg">StudyOS está bloqueado</h1>
        <p className="text-sm text-muted mt-1 mb-4">Ingresá tu PIN para continuar.</p>
        <Input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" className="text-center tracking-[.5em] text-lg" />
        {err && <p className="text-sm text-bad mt-2">{err}</p>}
        {tries >= 5 && <p className="text-xs text-muted mt-2">Si olvidaste el PIN, la única forma de recuperar el acceso es borrar los datos de la app desde los ajustes del sistema (se pierden los datos locales que no hayas exportado).</p>}
        <Button type="submit" variant="primary" className="w-full mt-4" loading={busy} disabled={!pin}>
          Desbloquear
        </Button>
      </form>
    </div>
  );
}
