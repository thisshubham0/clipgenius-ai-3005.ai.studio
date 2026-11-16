import React, { useEffect, useState } from 'react';
import { FolderOpen, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ProjectDTO } from '../shared/types';
import { formatTimecode } from '../utils/youtube';

interface ProjectsViewProps {
  onOpenProject: (projectId: number) => void;
  onCreateNew: () => void;
}

export function ProjectsView({ onOpenProject, onCreateNew }: ProjectsViewProps) {
  const { authFetch } = useAuth();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'draft'>('all');
  const [error, setError] = useState('');

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/projects');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load projects.');
      setProjects(data.projects || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load projects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (projectId: number) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete project.');
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const filtered = projects.filter((p) => {
    const matchesQuery =
      !query.trim() ||
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.channelName.toLowerCase().includes(query.toLowerCase());
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'completed'
          ? p.status === 'completed'
          : p.status !== 'completed';
    return matchesQuery && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">My Projects</h1>
          <p className="mt-1 text-sm text-slate-400">
            All saved video analyses, transcripts, and rendered clip sets.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg whitespace-nowrap shrink-0 cursor-pointer self-start"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          New Video Project
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or channel..."
            aria-label="Filter projects"
            className="w-full pl-9 pr-3 py-2 text-xs bg-[#111520] border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#111520] border border-white/10 rounded-lg self-start">
          {(
            [
              ['all', 'All'],
              ['completed', 'Completed'],
              ['draft', 'In Progress / Draft'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-56 rounded-xl bg-[#111520] border border-white/10 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-xl bg-[#111520] border border-white/10 text-center space-y-3">
          <p className="text-base font-semibold text-white">No matching projects</p>
          <p className="text-sm text-slate-400">
            Create a new project from a YouTube link, uploaded video, or authorized studio sample.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((proj) => (
            <article
              key={proj.id}
              className="rounded-xl bg-[#111520] border border-white/10 overflow-hidden flex flex-col justify-between"
            >
              <div>
                <img
                  src={proj.thumbnailUrl || '/src/assets/images/hero_studio_preview_1794825184394.jpg'}
                  alt={proj.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-40 object-cover"
                />
                <div className="p-5 space-y-2">
                  <p className="text-xs text-slate-400 font-mono tabular-nums">
                    {proj.status} · {proj.clipCount ?? 0} clips
                    {proj.durationSec > 0 ? ` · ${formatTimecode(proj.durationSec)}` : ''}
                  </p>
                  <h2 className="font-display text-base font-semibold text-white leading-snug">
                    {proj.title}
                  </h2>
                  <p className="text-xs text-slate-400 truncate">
                    {proj.channelName || proj.sourceType}
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5 pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpenProject(proj.id)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  Open Project
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(proj.id)}
                  aria-label={`Delete project ${proj.title}`}
                  className="p-2 text-slate-400 hover:text-rose-400 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
