import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { ActionBar, Button, EmptyState, NotFound, ScreenHeader, TextArea, errorMessage } from '../components/ui';
import { TopActions } from '../components/Shell';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { api } from '../api';
import { LIMITS, PHOTO_MAX_BYTES, PHOTO_TYPES } from '../../shared/domain.js';

/** S11 – new visit record with an optional photo. The record is only saved if the photo upload succeeded. */
export function RecordFormScreen() {
  const { t } = useI18n();
  const s = useAppState();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const task = s.tasks.find((x) => x.id === Number(id));
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!task) return <NotFound />;
  const allowed = (task.status === 'accepted' || task.status === 'completed') && (task.assignee_id === s.me.id || s.me.role === 'coordinator');

  function pick(f: File | undefined) {
    setPhotoError(null);
    if (!f) return;
    if (!PHOTO_TYPES.includes(f.type)) {
      setPhotoError(t('errors.photo_type'));
      return;
    }
    if (f.size > PHOTO_MAX_BYTES) {
      setPhotoError(t('errors.photo_too_large'));
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function removePhoto() {
    setFile(null);
    setPreview(null);
    setPhotoError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function save() {
    setFormError(null);
    if (!note.trim()) {
      setNoteError(t('errors.required'));
      return;
    }
    setNoteError(null);
    setBusy(true);
    let photoId: number | null = null;
    if (file) {
      try {
        photoId = (await api.upload<{ id: number }>('/api/photos', file)).id;
      } catch (e) {
        // Do not save the record pretending the photo is attached.
        setPhotoError(`${t('records.uploadFailed')} ${errorMessage(t, e)}`);
        setBusy(false);
        return;
      }
    }
    try {
      await mutate('post', `/api/tasks/${task!.id}/records`, { note, photo_id: photoId });
      toast({ title: t('toast.recordSaved') });
      navigate(`/tasks/${task!.id}`, { replace: true }); // → S8
    } catch (e) {
      setFormError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title={t('records.newTitle')} back />
      <div className="screen-body form-body">
        <p className="muted">{t('records.forTask', { title: task.title })}</p>
        {!allowed ? (
          <p className="form-error" role="alert">{t('errors.forbidden')}</p>
        ) : (
          <>
            <TextArea label={t('records.note')} rows={6} maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} error={noteError} placeholder={t('records.notePlaceholder')} />
            <div className="field">
              <input ref={fileInput} id="photo-input" type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-describedby="photo-hint" />
              {preview ? (
                <div className="photo-preview">
                  <img src={preview} alt={t('records.photoPreview')} />
                  <Button variant="ghost" onClick={removePhoto}><Icon name="trash" size={20} /> {t('records.removePhoto')}</Button>
                </div>
              ) : (
                <label htmlFor="photo-input" className="dashed-btn">
                  <Icon name="photo" /> {t('records.attachPhoto')}
                </label>
              )}
              <p id="photo-hint" className="field-hint">{t('records.photoHint', { mb: PHOTO_MAX_BYTES / 1024 / 1024 })}</p>
              {photoError && <p className="field-error" role="alert">{photoError}</p>}
            </div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
          </>
        )}
      </div>
      {allowed && (
        <ActionBar>
          <Button variant="primary" block disabled={busy} onClick={save}>{busy ? t('common.saving') : t('common.save')}</Button>
        </ActionBar>
      )}
    </div>
  );
}

/** "Záznamy" tab – all visit records, newest first. */
export function RecordsScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { memberName, taskById } = useSelectors();
  return (
    <div className="screen">
      <ScreenHeader title={t('records.title')} actions={<TopActions />} />
      <div className="screen-body">
        {s.records.length === 0 ? <EmptyState>{t('records.emptyAll')}</EmptyState> : (
          <ul className="plain-list">
            {s.records.map((r) => (
              <li key={r.id} className="panel record">
                <Link to={`/tasks/${r.task_id}`} className="record-task">{taskById.get(r.task_id)?.title}</Link>
                <p className="muted small">{memberName(r.author_id)} · {fmt.dateTime(r.created_at)}</p>
                <p className="record-note">{r.note}</p>
                {r.photo_id && <img className="record-photo" src={`/api/photos/${r.photo_id}`} alt={t('records.photoAlt', { name: memberName(r.author_id) })} loading="lazy" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
