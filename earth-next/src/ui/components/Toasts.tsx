import { Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-preact";
import { toasts } from "../../state/store.ts";

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((tt) => {
        const Icon = ICONS[tt.kind];
        return (
          <div key={tt.id} class={`toast glass ${tt.kind}`}>
            <Icon size={18} />
            <span>{tt.message}</span>
          </div>
        );
      })}
    </div>
  );
}
