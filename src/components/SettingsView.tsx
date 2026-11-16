import React, { useState } from 'react';
import { Check, Loader2, LogIn, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AspectRatio, CaptionStyle, ExportResolution } from '../shared/types';

interface SettingsViewProps {
  onOpenAuth: () => void;
}

export function SettingsView({ onOpenAuth }: SettingsViewProps) {
  const { profile, authFetch, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<AspectRatio>(
    profile?.preferences?.defaultAspectRatio || '9:16'
  );
  const [defaultCaptionStyle, setDefaultCaptionStyle] = useState<CaptionStyle>(
    profile?.preferences?.defaultCaptionStyle || 'Modern'
  );
  const [defaultResolution, setDefaultResolution] = useState<ExportResolution>(
    profile?.preferences?.defaultResolution || '1080p'
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const res = await authFetch('/api/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          preferences: {
            defaultAspectRatio,
            defaultCaptionStyle,
            defaultResolution,
          },
        }),
      });
      if (!res.ok) throw new Error('Could not save profile preferences.');
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Settings &amp; Profile</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your account connection and default clip export preferences.
        </p>
      </div>

      {/* Account Card */}
      <section className="p-6 rounded-xl bg-[#111520] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src={
              profile?.photoUrl ||
              '/src/assets/images/avatar_creator_profile_1794825184690.jpg'
            }
            alt={profile?.displayName || 'Creator'}
            referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full object-cover border border-white/10"
          />
          <div>
            <p className="font-display text-base font-semibold text-white">
              {profile?.displayName || 'Studio Creator'}
            </p>
            <p className="text-xs text-slate-400">{profile?.email}</p>
            <p className="mt-1 text-xs font-mono text-indigo-400 tabular-nums">
              {profile?.plan} · {profile?.credits ?? 120} credits remaining
            </p>
          </div>
        </div>

        {profile?.isDemo && (
          <button
            type="button"
            onClick={onOpenAuth}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-center"
          >
            <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            Connect Google Account
          </button>
        )}
      </section>

      {/* Preferences Form */}
      <form
        onSubmit={handleSave}
        className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-5"
      >
        <h2 className="font-display text-base font-semibold text-white">
          Workspace Defaults
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="pref-name" className="block text-xs font-medium text-slate-300 mb-1.5">
              Creator Display Name
            </label>
            <input
              id="pref-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#090B10] border border-white/10 rounded-lg text-white"
            />
          </div>

          <div>
            <label htmlFor="pref-ratio" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Aspect Ratio
            </label>
            <select
              id="pref-ratio"
              value={defaultAspectRatio}
              onChange={(e) => setDefaultAspectRatio(e.target.value as AspectRatio)}
              className="w-full px-3 py-2 text-sm bg-[#090B10] border border-white/10 rounded-lg text-white"
            >
              <option value="9:16">9:16 Vertical</option>
              <option value="1:1">1:1 Square</option>
              <option value="16:9">16:9 Landscape</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-captions" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Caption Style
            </label>
            <select
              id="pref-captions"
              value={defaultCaptionStyle}
              onChange={(e) => setDefaultCaptionStyle(e.target.value as CaptionStyle)}
              className="w-full px-3 py-2 text-sm bg-[#090B10] border border-white/10 rounded-lg text-white"
            >
              <option value="Modern">Modern</option>
              <option value="Animated">Animated</option>
              <option value="Bold">Bold</option>
              <option value="Karaoke">Karaoke</option>
              <option value="Minimal">Minimal</option>
            </select>
          </div>

          <div>
            <label htmlFor="pref-res" className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Export Resolution
            </label>
            <select
              id="pref-res"
              value={defaultResolution}
              onChange={(e) => setDefaultResolution(e.target.value as ExportResolution)}
              className="w-full px-3 py-2 text-sm bg-[#090B10] border border-white/10 rounded-lg text-white"
            >
              <option value="1080p">1080p Full HD</option>
              <option value="720p">720p Standard</option>
            </select>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Saved to PostgreSQL
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg cursor-pointer disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
}
