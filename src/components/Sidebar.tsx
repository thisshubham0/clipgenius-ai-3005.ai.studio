import React from 'react';
import {
  Download,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  PlusSquare,
  Scissors,
  Settings,
  X,
} from 'lucide-react';
import type { UserProfile } from '../context/AuthContext';

export type WorkspaceTab =
  | 'dashboard'
  | 'create'
  | 'projects'
  | 'templates'
  | 'downloads'
  | 'settings'
  | 'editor';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onGoLanding: () => void;
  profile: UserProfile | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'create', label: 'Create Clips', icon: PlusSquare },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'downloads', label: 'Download Center', icon: Download },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  onGoLanding,
  profile,
  onOpenAuth,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col justify-between bg-[#0D1017] border-r border-white/10 w-64 px-4 py-5">
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <button
            type="button"
            onClick={onGoLanding}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Scissors className="w-4 h-4" aria-hidden="true" />
            </span>
            <span className="font-display text-base font-bold text-white whitespace-nowrap">
              ClipGenius AI
            </span>
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="lg:hidden p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav aria-label="Workspace navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeTab === item.id || (activeTab === 'editor' && item.id === 'create');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600/15 text-white border border-indigo-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-4 pt-4 border-t border-white/10">
        {profile && (
          <div className="px-2 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Processing Credits</span>
              <span className="font-mono font-semibold text-white tabular-nums">
                {profile.credits}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.round((profile.credits / 120) * 100))}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={
                profile?.photoUrl ||
                '/src/assets/images/avatar_creator_profile_1794825184690.jpg'
              }
              alt={profile?.displayName || 'Creator avatar'}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {profile?.displayName || 'Studio Guest'}
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {profile?.isDemo ? 'Demo Workspace' : profile?.plan || 'Pro'}
              </p>
            </div>
          </div>

          {profile?.isDemo ? (
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-2.5 py-1 text-xs font-medium text-indigo-300 hover:text-white bg-indigo-600/20 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign In
            </button>
          ) : (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/5 cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block shrink-0">{navContent}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-50 h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}
