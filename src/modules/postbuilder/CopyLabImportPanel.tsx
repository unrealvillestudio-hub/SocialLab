/**
 * CopyLabImportPanel.tsx — SocialLab
 *
 * Panel de importación CopyLab → SocialLab.
 * Se integra dentro de PostBuilderModule.tsx.
 *
 * DÓNDE AÑADIRLO EN PostBuilderModule.tsx:
 *
 * 1. Import al principio:
 *    import CopyLabImportPanel from './CopyLabImportPanel';
 *    import { importFromClipboard, parseCopyLabInput, buildDraftPost } from '../../services/copyLabBridge';
 *
 * 2. En el state del módulo:
 *    const [showImport, setShowImport] = useState(false);
 *    const [importText, setImportText]  = useState('');
 *
 * 3. Handler de importación:
 *    const handleCopyLabImport = (text: string) => {
 *      const result = parseCopyLabInput({ rawInput: text, brandId: selectedBrand.id, platform: selectedPlatform.id });
 *      if (result.success) {
 *        setCopy(result.copy);
 *        setShowImport(false);
 *        setImportText('');
 *        // Si el resultado trae plataforma específica, actualízala:
 *        // if (result.platform) setSelectedPlatform(PLATFORMS[result.platform]);
 *      }
 *    };
 *
 * 4. En el JSX, añadir el panel antes del copy composer:
 *    <CopyLabImportPanel
 *      onImport={handleCopyLabImport}
 *      brandId={selectedBrand.id}
 *      platform={selectedPlatform.id}
 *    />
 *
 * Coloca este archivo en: src/modules/postbuilder/CopyLabImportPanel.tsx
 */

import React, { useState } from 'react';
import { importFromClipboard, parseCopyLabInput } from '../../services/copyLabBridge';
import { PlatformId } from '../../core/types';

interface Props {
  brandId:  string;
  platform: PlatformId;
  onImport: (copy: string) => void;
}

export default function CopyLabImportPanel({ brandId, platform, onImport }: Props) {
  const [open, setOpen]       = useState(false);
  const [text, setText]       = useState('');
  const [error, setError]     = useState('');
  const [preview, setPreview] = useState('');
  const [sourceType, setSourceType] = useState('');

  const handlePaste = async () => {
    setError('');
    const result = await importFromClipboard(brandId, platform);
    if (result.success) {
      setText(result.copy);
      setPreview(result.copy.slice(0, 200) + (result.copy.length > 200 ? '...' : ''));
      setSourceType(result.sourceType);
    } else {
      setError(result.error ?? 'Error al leer el portapapeles.');
    }
  };

  const handleManualParse = () => {
    setError('');
    const result = parseCopyLabInput({ rawInput: text, brandId, platform });
    if (result.success) {
      setPreview(result.copy.slice(0, 200) + (result.copy.length > 200 ? '...' : ''));
      setSourceType(result.sourceType);
    } else {
      setError(result.error ?? 'No se pudo parsear el input.');
    }
  };

  const handleApply = () => {
    if (!text.trim()) return;
    onImport(text);
    setText('');
    setPreview('');
    setError('');
    setOpen(false);
  };

  const SOURCE_LABELS: Record<string, string> = {
    text:                'Copy de texto',
    video_podcast_json:  'Bloques VideoPodcast (JSON)',
    structured_json:     'JSON estructurado',
  };

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 6,
          border: '1px solid #1E2A3A',
          background: open ? 'rgba(0,180,173,0.08)' : 'transparent',
          color: open ? '#00E8D0' : '#4A5E70',
          fontSize: 11, fontFamily: 'Syne Mono, monospace',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <span>↓</span>
        Importar de CopyLab
        {open && <span style={{ marginLeft: 4 }}>·</span>}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          marginTop: 8, padding: 16,
          background: '#0B0E13', border: '1px solid #00B4AD33',
          borderRadius: 8, space: 12,
        }}>
          <div style={{ marginBottom: 10, color: '#6E88A0', fontSize: 12, lineHeight: 1.6 }}>
            Genera el copy en CopyLab, copia el resultado, y pégalo aquí.
            Acepta texto libre, JSON de bloques VideoPodcast, o JSON estructurado.
          </div>

          {/* Textarea */}
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setPreview(''); setSourceType(''); }}
            placeholder="Pega aquí el output de CopyLab — texto, JSON de bloques o JSON estructurado..."
            style={{
              width: '100%', height: 100, resize: 'vertical',
              background: '#10141C', border: '1px solid #182030',
              borderRadius: 6, padding: '8px 12px',
              color: '#CDD5E0', fontSize: 12, lineHeight: 1.6,
              outline: 'none', marginBottom: 8, boxSizing: 'border-box',
            }}
          />

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: preview ? 8 : 0 }}>
            <button
              onClick={handlePaste}
              style={{
                padding: '5px 12px', borderRadius: 6,
                border: '1px solid #1E2A3A',
                background: 'transparent', color: '#6E88A0',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              📋 Pegar portapapeles
            </button>
            <button
              onClick={handleManualParse}
              style={{
                padding: '5px 12px', borderRadius: 6,
                border: '1px solid #1E2A3A',
                background: 'transparent', color: '#6E88A0',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              🔍 Parsear texto
            </button>
            <button
              onClick={handleApply}
              disabled={!text.trim()}
              style={{
                padding: '5px 16px', borderRadius: 6,
                border: 'none',
                background: text.trim() ? '#00B4AD' : '#1E2A3A',
                color: text.trim() ? '#000' : '#4A5E70',
                fontSize: 11, fontWeight: 700, cursor: text.trim() ? 'pointer' : 'default',
                marginLeft: 'auto',
              }}
            >
              Aplicar al composer →
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{ color: '#E84040', fontSize: 11, marginTop: 6 }}>⚠ {error}</div>
          )}

          {/* Preview */}
          {preview && (
            <div style={{
              marginTop: 8, padding: 10,
              background: '#10141C', border: '1px solid #182030', borderRadius: 6,
            }}>
              <div style={{
                fontSize: 9.5, fontFamily: 'Syne Mono, monospace',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: '#00B4AD', marginBottom: 6,
              }}>
                Vista previa · {SOURCE_LABELS[sourceType] ?? sourceType}
              </div>
              <div style={{ fontSize: 12, color: '#6E88A0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {preview}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
