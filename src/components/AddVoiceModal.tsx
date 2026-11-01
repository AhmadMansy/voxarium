// SPDX-License-Identifier: AGPL-3.0-or-later
import { useStudio } from '../state';
import { Icon } from './Icons';
import { Modal } from './Modal';

/**
 * Adding a voice depends on what the active model can do, and everything here stays on this
 * computer: nothing is uploaded.
 *  - models with a voice-file format (for example `.safetensors`) import a file;
 *  - models that clone from a short recording read a clip you put in the references folder;
 *  - other models bring a fixed set of voices.
 */
export function AddVoiceModal() {
  const { addVoiceOpen, closeAddVoice, importVoiceFile, models } = useStudio();
  const model = models.activeModel;
  const canImport = model.capabilities.voiceImport;
  const canCloneLocally = model.capabilities.voiceClone && model.capabilities.cloneKind === 'local';

  const importFile = async () => {
    const voice = await importVoiceFile();
    if (voice) closeAddVoice();
  };

  return (
    <Modal
      open={addVoiceOpen}
      onClose={closeAddVoice}
      title="Add a voice"
      subtitle={`For ${model.shortName}. Everything stays on this computer.`}
      size="md"
      icon={<Icon name="mic" size={18} />}
      footer={
        <>
          <span className="modal__foot-note">
            <Icon name="shield" size={14} /> Nothing is uploaded
          </span>
          <button className="btn btn--subtle" onClick={closeAddVoice}>
            Close
          </button>
        </>
      }
    >
      <div className="add-voice">
        {canCloneLocally && (
          <section className="add-voice__option">
            <h3>Clone from a recording</h3>
            <p>
              {model.shortName} copies a voice from a short, clean clip. Only clone a voice you own or have
              permission to use.
            </p>
            <ol>
              <li>Record 10 to 15 seconds of clear speech with no background noise (WAV, FLAC or MP3).</li>
              <li>Put the file in the references folder. An optional <code>.txt</code> file with the same name holds its transcript.</li>
              <li>Reload the model. The clip appears in the voice list.</li>
            </ol>
            <button className="btn btn--subtle" onClick={() => void window.studio.models.openReferences()}>
              <Icon name="folderOpen" size={15} /> Open the references folder
            </button>
          </section>
        )}

        {canImport && (
          <section className="add-voice__option">
            <h3>Import a voice file</h3>
            <p>
              Choose a voice file made for {model.shortName} (<code>.safetensors</code>). It is checked and copied to
              this device.
            </p>
            <button className="btn btn--primary" onClick={() => void importFile()}>
              <Icon name="upload" size={15} /> Choose a voice file
            </button>
          </section>
        )}

        {!canImport && !canCloneLocally && (
          <section className="add-voice__option">
            <h3>{model.shortName} uses its own voices</h3>
            <p>
              This model comes with a fixed set of voices and cannot add new ones. Switch to a model that can clone or
              import voices to add your own.
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}
