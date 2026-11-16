import React, { useEffect, useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { DownloadDTO } from '../shared/types';
import { formatFileSize } from '../utils/youtube';

interface DownloadsViewProps {
  onOpenProject: (projectId: number) => void;
}

export function DownloadsView({ onOpenProject }: DownloadsViewProps) {
  const { authFetch, token } = useAuth();
  const [downloads, setDownloads] = useState<DownloadDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authFetch('/api/downloads')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load download history.');
        return data.downloads as DownloadDTO[];
      })
      .then((list) => {
        if (active) setDownloads(list || []);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load exports.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authFetch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Download Center</h1>
        <p className="mt-1 text-sm text-slate-400">
          History of exported MP4 video clips rendered by FFmpeg.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="rounded-xl bg-[#111520] border border-white/10 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-12 rounded bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : downloads.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Download className="w-8 h-8 text-slate-500 mx-auto" aria-hidden="true" />
            <p className="text-base font-semibold text-white">No exports yet</p>
            <p className="text-sm text-slate-400">
              Download any generated clip to see your MP4 export history here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th className="py-3.5 px-5 font-medium min-w-[220px]">Clip Title</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Format</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Aspect</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Resolution</th>
                  <th className="py-3.5 px-4 font-medium text-right whitespace-nowrap">Size</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Exported</th>
                  <th className="py-3.5 px-5 font-medium text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-sm">
                {downloads.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02]">
                    <td className="py-3.5 px-5 font-medium text-white min-w-[220px]">{item.clipTitle}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-300 whitespace-nowrap">{item.format}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                      {item.aspectRatio}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                      {item.resolution}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-300 text-right tabular-nums whitespace-nowrap">
                      {formatFileSize(item.fileSizeBytes)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenProject(item.projectId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          Project
                        </button>
                        <a
                          href={`/api/clips/${item.clipId}/download?resolution=${encodeURIComponent(item.resolution)}&token=${encodeURIComponent(token || '')}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          MP4
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
