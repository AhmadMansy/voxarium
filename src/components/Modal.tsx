// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, type ReactNode } from 'react';
import { classNames } from '../lib/utils';
import { Icon } from './Icons';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', icon }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={classNames('modal', `modal--${size}`)} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__head">
          <div className="modal__heading">
            {icon && <span className="modal__icon">{icon}</span>}
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" size={17} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}
