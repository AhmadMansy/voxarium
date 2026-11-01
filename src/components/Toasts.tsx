// SPDX-License-Identifier: AGPL-3.0-or-later
import { useStudio } from '../state';
import { classNames } from '../lib/utils';
import { Icon } from './Icons';

export function Toasts() {
  const { toasts, dismissToast } = useStudio();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={classNames('toast', `toast--${toast.kind}`)}>
          <span className="toast__icon">
            <Icon
              name={toast.kind === 'success' ? 'checkCircle' : toast.kind === 'error' ? 'alert' : 'info'}
              size={18}
            />
          </span>
          <div className="toast__body">
            <strong>{toast.message}</strong>
            {toast.detail && <span>{toast.detail}</span>}
          </div>
          <button className="toast__close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
