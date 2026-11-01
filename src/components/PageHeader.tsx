// SPDX-License-Identifier: AGPL-3.0-or-later
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
  const { models, setPage } = useStudio();
  const installed = models.install.installed;
  return (
    <div className="model-required">
      <span className="model-required__icon">
        <Icon name="downloadCloud" size={22} />
      </span>
      <div>
        <strong>{installed ? 'Preparing the voice engine' : `${models.activeModel.shortName} is not installed yet`}</strong>
        <p>
          {installed
            ? 'The model is on disk. The local runtime is warming up — this only takes a moment.'
            : `Install ${models.activeModel.shortName} once, then every generation runs entirely on this device.`}
        </p>
      </div>
      {!installed && (
        <button className="btn btn--primary btn--sm" onClick={() => setPage('models')}>
          <Icon name="layers" size={15} />
          Choose a model
        </button>
      )}
    </div>
  );
}
