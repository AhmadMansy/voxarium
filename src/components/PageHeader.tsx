import type { ReactNode } from 'react';
import { useStudio } from '../state';
import { Icon, type IconName } from './Icons';

interface PageHeaderProps {
  icon: IconName;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ icon, eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <div className="page-header__eyebrow">
          <span className="page-header__icon">
            <Icon name={icon} size={14} />
          </span>
          {eyebrow || 'Voxarium'}
        </div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function ModelRequired({ onOpenSetup }: { onOpenSetup: () => void }) {
  const { model } = useStudio();
  return (
    <div className="model-required">
      <span className="model-required__icon">
        <Icon name="downloadCloud" size={22} />
      </span>
      <div>
        <strong>{model?.installed ? 'Preparing the voice engine' : 'Phonon 31M is not installed yet'}</strong>
        <p>
          {model?.installed
            ? 'The model is on disk. The local runtime is warming up — this only takes a moment.'
            : 'Download the 64 MB checkpoint once, then every generation runs entirely on this device.'}
        </p>
      </div>
      {!model?.installed && (
        <button className="btn btn--primary btn--sm" onClick={onOpenSetup}>
          <Icon name="download" size={15} />
          Set up model
        </button>
      )}
    </div>
  );
}
