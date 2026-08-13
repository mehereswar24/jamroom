'use client';

import { useState } from 'react';
import {
    AlertCircle, ArrowDown, ArrowUp, Check, Disc3, GripVertical, ListPlus, Loader2, Music2,
    Play, Search, Shuffle, Trash2, Wrench, X
} from 'lucide-react';
import { api, driveImport } from '@/hooks/api';
import { useRoomStore } from '@/hooks/useRoomStore';
import { formatDuration } from '@/lib/ids';
import type { QueueItem, VideoCandidate } from '@/lib/types';

export default function QueuePanel() {
    const queue = useRoomStore(s => s.queue);
    const playback = useRoomStore(s => s.playback);
    const selfClientId = useRoomStore(s => s.selfClientId);
    const hostClientId = useRoomStore(s => s.hostClientId);
    const guestControls = useRoomStore(s => s.guestControls);
    const importProgress = useRoomStore(s => s.importProgress);
    const [addOpen, setAddOpen] = useState(false);
    const [fixItem, setFixItem] = useState<QueueItem | null>(null);
    const [filterText, setFilterText] = useState('');
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

    const canControl = selfClientId === hostClientId || guestControls;
    const upcoming = queue.filter(q => !q.playedAt || q.id === playback.queueItemId);
    const filteredUpcoming = upcoming.filter(q =>
        !filterText.trim() ||
        q.title.toLowerCase().includes(filterText.toLowerCase()) ||
        (q.artist && q.artist.toLowerCase().includes(filterText.toLowerCase()))
    );

    const totalDurationMs = upcoming.reduce((acc, item) => acc + (item.durationMs || 0), 0);

    const handleShuffle = () => { void api.queue('shuffle'); };

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* Queue Header & Search Filter */}
            <div className="p-3 border-b border-white/10 bg-black/40 space-y-2">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAddOpen(true)}
                        className="flex-1 flex items-center justify-center gap-2 neon-btn-primary py-2.5 rounded-xl text-xs font-bold font-heading uppercase tracking-wider shadow-md cursor-pointer"
                    >
                        <ListPlus size={16} />
                        <span>Add Songs / Import</span>
                    </button>
                    {canControl && upcoming.length > 1 && (
                        <button
                            onClick={handleShuffle}
                            title="Shuffle queue order"
                            className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shrink-0"
                        >
                            <Shuffle size={14} />
                            <span>Shuffle</span>
                        </button>
                    )}
                </div>

                {/* Search & Stats Bar */}
                {upcoming.length > 0 && (
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                            <input
                                value={filterText}
                                onChange={e => setFilterText(e.target.value)}
                                placeholder={`Search ${upcoming.length} queued songs…`}
                                className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-7 py-1 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/40"
                            />
                            {filterText && (
                                <button onClick={() => setFilterText('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        <span className="text-[10px] font-mono text-white/40 shrink-0 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                            {formatDuration(totalDurationMs)}
                        </span>
                    </div>
                )}

                {importProgress && (
                    <div className="glass rounded-xl p-2.5 border-white/20">
                        <div className="flex items-center justify-between text-xs text-white/80 font-medium">
                            <span className="truncate text-[11px]">Importing “{importProgress.playlistName}”</span>
                            <span className="font-mono tabular-nums text-white text-[11px]">{importProgress.done}/{importProgress.total}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-1.5">
                            <div
                                className="h-full bg-white transition-all duration-300 shadow-[0_0_12px_rgba(255,255,255,0.6)]"
                                style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable Compact Track List with Drag & Drop */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0 max-h-[55vh] lg:max-h-full">
                {filteredUpcoming.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2 text-white/35 py-10 px-4 text-center">
                        <Music2 size={22} className="text-white/60" />
                        <p className="text-xs font-semibold text-white/60">
                            {filterText ? 'No matching tracks found' : 'Queue is empty'}
                        </p>
                    </div>
                )}
                {filteredUpcoming.map((item, idx) => {
                    const isCurrent = item.id === playback.queueItemId;
                    const mayRemove = canControl || item.addedBy !== '';
                    const canPlay = !isCurrent && (item.youtubeVideoId || item.mediaUrl) && item.matchStatus !== 'failed';
                    const isTargetDrop = dragOverIdx === idx;
                    const isBeingDragged = draggedIdx === idx;

                    return (
                        <div
                            key={item.id}
                            draggable={canControl && !isCurrent}
                            onDragStart={() => setDraggedIdx(idx)}
                            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                            onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (draggedIdx !== null && draggedIdx !== idx) {
                                    const targetItem = filteredUpcoming[draggedIdx];
                                    if (targetItem) reorderTo(targetItem.id, idx, queue, playback.queueItemId);
                                }
                                setDraggedIdx(null); setDragOverIdx(null);
                            }}
                            className={`group flex items-center gap-2.5 rounded-2xl px-2.5 py-2 transition-all ${
                                isBeingDragged ? 'opacity-40 scale-95 border-dashed border-white' :
                                isTargetDrop ? 'border-t-2 border-white bg-white/20 translate-y-1' :
                                isCurrent
                                    ? 'bg-white/15 border border-white/30 text-white shadow-[0_0_20px_rgba(255,255,255,0.15)]'
                                    : 'hover:bg-white/10 border border-transparent'
                            }`}
                        >
                            {/* Drag Handle Icon */}
                            {canControl && !isCurrent && (
                                <span className="text-white/20 group-hover:text-white/60 cursor-grab active:cursor-grabbing shrink-0 transition-colors">
                                    <GripVertical size={14} />
                                </span>
                            )}

                            {/* Track Art / Album Covers */}
                            <div className="relative shrink-0 w-9 h-9 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center">
                                {item.albumArtUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={item.albumArtUrl} alt="" className="w-full h-full object-cover rounded-full" />
                                ) : (
                                    <Music2 size={15} className="text-white/30" />
                                )}
                                {isCurrent && (
                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center rounded-full">
                                        <Disc3 size={16} className="text-white animate-spin-vinyl rounded-full" />
                                    </div>
                                )}
                            </div>

                            {/* Track Title & Artist */}
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => canPlay && void api.playback('playItem', { queueItemId: item.id })}>
                                <p className={`text-xs font-semibold truncate ${isCurrent ? 'text-white font-heading font-bold' : 'text-white'}`}>
                                    {item.title}
                                </p>
                                <p className="text-[10px] text-white/40 truncate flex items-center gap-1 mt-0.5">
                                    <span>{item.artist ?? ''}</span>
                                    <span>·</span>
                                    <span className="font-mono">{formatDuration(item.durationMs)}</span>
                                    {item.source === 'spotify' && !item.youtubeVideoId && item.matchStatus !== 'failed' && (
                                        <span className="text-white/80 font-medium flex items-center gap-1 ml-1">
                                            <Loader2 size={10} className="animate-spin" /> matching…
                                        </span>
                                    )}
                                </p>
                            </div>

                            {/* Status Alerts */}
                            {item.matchStatus === 'needs_review' && item.youtubeVideoId && (
                                <button onClick={() => setFixItem(item)} title="Low-confidence match — verify"
                                    className="text-amber-300 hover:text-amber-200 p-1 cursor-pointer"><Wrench size={14} /></button>
                            )}
                            {item.matchStatus === 'failed' && (
                                <button onClick={() => setFixItem(item)} title="No match found — fix manually"
                                    className="text-red-400 hover:text-red-300 p-1 cursor-pointer"><AlertCircle size={14} /></button>
                            )}

                            {/* Action Buttons: Play button ALWAYS visible! */}
                            <div className="flex items-center gap-1">
                                {canPlay && (
                                    <button
                                        onClick={() => void api.playback('playItem', { queueItemId: item.id })}
                                        title="Play now for room"
                                        className="w-7 h-7 rounded-lg bg-white hover:bg-slate-200 text-black flex items-center justify-center transition-all cursor-pointer shadow-sm"
                                    >
                                        <Play size={12} className="ml-0.5 fill-black text-black" />
                                    </button>
                                )}
                                {mayRemove && (
                                    <button
                                        title="Remove from queue"
                                        onClick={() => {
                                            // Optimistically remove from local state instantly (0ms delay)
                                            const st = useRoomStore.getState();
                                            st.setQueue(st.queue.filter(q => q.id !== item.id));
                                            // Persist to server and broadcast to all room members
                                            void api.queue('remove', { queueItemId: item.id });
                                        }}
                                        className="p-1.5 text-white/30 hover:text-red-400 active:scale-90 transition-all cursor-pointer"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {addOpen && <AddTracksModal close={() => setAddOpen(false)} />}
            {fixItem && <FixMatchModal item={fixItem} close={() => setFixItem(null)} />}
        </div>
    );
}

/** Move an item to a new position within the upcoming list → full ordered id list. */
function reorderTo(queueItemId: number, upcomingIndex: number, queue: QueueItem[], currentId: number | null) {
    const played = queue.filter(q => q.playedAt && q.id !== currentId).length;
    const ids = queue.map(q => q.id);
    const from = ids.indexOf(queueItemId);
    if (from === -1) return;
    const to = Math.max(0, Math.min(ids.length - 1, played + upcomingIndex));
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    void api.queue('reorder', { orderedIds: ids });
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
    return (
        <button onClick={onClick} title={title}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/70 transition-colors">
            {children}
        </button>
    );
}

/* ── Add tracks modal: YouTube search + Spotify import ── */

function AddTracksModal({ close }: { close: () => void }) {
    const [tab, setTab] = useState<'search' | 'spotify' | 'bulk'>('spotify');
    const [q, setQ] = useState('');
    const [results, setResults] = useState<VideoCandidate[]>([]);
    const [searching, setSearching] = useState(false);
    const [added, setAdded] = useState<Set<string>>(new Set());
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [bulkText, setBulkText] = useState('');
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [linkAdded, setLinkAdded] = useState<string | null>(null);

    const isLink = /^https?:\/\//i.test(q.trim());

    // Paste any playable link: YouTube URLs, or direct audio/video file URLs
    // (.mp3/.mp4/.webm…) from any host — the server resolves and queues it.
    const addLink = () => {
        setSearching(true); setError(null); setLinkAdded(null);
        void api.queue<{ title: string }>('addUrl', { url: q.trim() }).then((res) => {
            setSearching(false);
            if (res.ok) {
                setLinkAdded(res.title);
                setQ('');
                setTimeout(() => setLinkAdded(null), 3500);
            } else {
                setError(res.error);
            }
        });
    };

    const search = async () => {
        if (!q.trim()) return;
        if (isLink) { addLink(); return; }
        setSearching(true); setError(null);
        try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q.trim())}`);
            const j = await res.json();
            if (!j.ok) throw new Error(j.error || 'Search failed');
            setResults(j.results);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Search failed');
        } finally {
            setSearching(false);
        }
    };

    const add = (v: VideoCandidate) => {
        void api.queue('add', { video: v }).then((res) => {
            if (res.ok) setAdded(s => new Set(s).add(v.videoId));
            else setError(res.error);
        });
    };

    const startImport = () => {
        const url = playlistUrl.trim();
        if (!url) return;
        setImporting(true); setError(null);
        void driveImport({ playlistUrl: url }).then((res) => {
            setImporting(false);
            if (res.ok) close();
            else setError(res.error);
        });
    };

    const startBulkImport = () => {
        const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return setError('Please paste at least one song name');
        setImporting(true); setError(null);

        const clientTracks = lines.map(line => {
            const parts = line.split(' - ');
            if (parts.length >= 2) return { name: parts.slice(1).join(' - ').trim(), artist: parts[0].trim(), durationMs: 0 };
            return { name: line, artist: '', durationMs: 0 };
        });

        void driveImport({ clientTracks, playlistName: 'Pasted songs' }).then((res) => {
            setImporting(false);
            if (res.ok) close();
            else setError(res.error);
        });
    };

    return (
        <Modal close={close} title="Add Songs to Queue">
            <div className="flex gap-1 mb-4 bg-white/5 rounded-xl p-1 border border-white/10">
                {([['spotify', 'Spotify Link'], ['bulk', 'Paste 500+ Songs'], ['search', 'YouTube Search']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => { setTab(key); setError(null); }}
                        className={`flex-1 text-xs sm:text-sm py-2.5 rounded-lg transition-colors font-semibold cursor-pointer ${
                            tab === key ? 'bg-white text-black font-bold shadow' : 'text-white/60 hover:text-white'
                        }`}>
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'search' ? (
                <>
                    <div className="flex gap-2">
                        <input
                            autoFocus value={q}
                            onChange={e => setQ(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && search()}
                            placeholder="Search songs — or paste a YouTube / audio / video link…"
                            className="flex-1 bg-black/60 border border-white/20 rounded-xl px-4 py-2.5 outline-none focus:border-white text-sm text-white placeholder:text-white/30"
                        />
                        <button onClick={search} disabled={searching}
                            title={isLink ? 'Add this link to the queue' : 'Search YouTube'}
                            className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-4 text-white disabled:opacity-50 cursor-pointer">
                            {searching ? <Loader2 size={16} className="animate-spin" /> : isLink ? <ListPlus size={16} /> : <Search size={16} />}
                        </button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-white/35">
                        Links play directly: YouTube URLs, or direct audio/video files (.mp3, .mp4, .webm…) from any site.
                    </p>
                    {linkAdded && (
                        <p className="mt-1.5 text-xs text-emerald-300 flex items-center gap-1.5">
                            <Check size={13} /> Added “{linkAdded}” to the queue
                        </p>
                    )}
                    <div className="mt-3 max-h-[45vh] overflow-y-auto space-y-1">
                        {results.map(v => (
                            <div key={v.videoId} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/10 transition-colors">
                                {v.thumb ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={v.thumb} alt="" className="w-14 h-9 rounded-lg object-cover shrink-0" />
                                ) : <div className="w-14 h-9 rounded-lg bg-white/5 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-white truncate">{v.title}</p>
                                    <p className="text-[11px] text-white/40 truncate">{v.channel} · {formatDuration(v.durationMs)}</p>
                                </div>
                                <button
                                    onClick={() => add(v)}
                                    disabled={added.has(v.videoId)}
                                    className={`text-xs rounded-lg px-3 py-1.5 transition-colors cursor-pointer ${
                                        added.has(v.videoId) ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'bg-white hover:bg-slate-200 text-black font-bold'
                                    }`}
                                >
                                    {added.has(v.videoId) ? <Check size={13} /> : 'Add'}
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            ) : tab === 'spotify' ? (
                <>
                    <p className="text-sm text-white/60 mb-2">
                        Paste a public Spotify playlist link below.
                    </p>
                    <input
                        autoFocus value={playlistUrl}
                        onChange={e => setPlaylistUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && startImport()}
                        placeholder="https://open.spotify.com/playlist/…"
                        className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-3 outline-none focus:border-white text-sm text-white placeholder:text-white/30"
                    />

                    <p className="mt-2 text-[11px] text-white/40 leading-tight">
                        Full playlists import automatically — 500+ track playlists supported. Tracks appear instantly and match to YouTube in the background.
                    </p>

                    <button
                        onClick={startImport} disabled={importing}
                        className="mt-4 w-full bg-white hover:bg-slate-200 text-black font-bold py-3 rounded-xl text-xs sm:text-sm font-heading tracking-wider uppercase transition-all cursor-pointer disabled:opacity-50 shadow-md"
                    >
                        {importing ? 'Reading playlist…' : 'Import Playlist'}
                    </button>
                </>
            ) : (
                <>
                    <p className="text-sm text-white/60 mb-2">
                        Paste any list of songs (up to 1,000+ tracks). Format: <span className="text-white font-mono text-xs">Artist - Song Title</span> or just song names on each line:
                    </p>
                    <textarea
                        autoFocus
                        value={bulkText}
                        onChange={e => setBulkText(e.target.value)}
                        placeholder={`The Weeknd - Blinding Lights\nTaylor Swift - Cruel Summer\nDrake - One Dance\n...`}
                        rows={6}
                        className="w-full bg-black/60 border border-white/20 rounded-xl p-3 outline-none focus:border-white text-xs font-mono text-white placeholder:text-white/30 resize-none"
                    />
                    <button
                        onClick={startBulkImport} disabled={importing}
                        className="mt-3 w-full bg-white hover:bg-slate-200 text-black font-bold py-3 rounded-xl text-xs sm:text-sm font-heading tracking-wider uppercase transition-all cursor-pointer disabled:opacity-50 shadow-md"
                    >
                        {importing ? 'Importing tracks…' : `Import ${bulkText.split('\n').filter(l => l.trim()).length || ''} Songs to Queue`}
                    </button>
                </>
            )}
            {error && <p className="mt-3 text-sm text-white font-medium bg-white/10 p-3 rounded-xl border border-white/20">{error}</p>}
        </Modal>
    );
}

/* ── Fix match modal ── */

function FixMatchModal({ item, close }: { item: QueueItem; close: () => void }) {
    const [q, setQ] = useState(`${item.artist ?? ''} ${item.title}`.trim());
    const [results, setResults] = useState<VideoCandidate[]>([]);
    const [searching, setSearching] = useState(false);

    const search = async () => {
        setSearching(true);
        try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
            const j = await res.json();
            if (j.ok) setResults(j.results);
        } finally {
            setSearching(false);
        }
    };

    const pick = (v: VideoCandidate) => {
        void api.queue('fixMatch', { queueItemId: item.id, video: v }).then((res) => {
            if (res.ok) close();
        });
    };

    return (
        <Modal close={close} title={`Fix match — ${item.title}`}>
            <p className="text-xs text-white/45 mb-3">
                Spotify says: <span className="text-white/80">{item.artist} — {item.title}</span> ({formatDuration(item.durationMs)}).
                Pick the right YouTube video:
            </p>
            <div className="flex gap-2">
                <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 outline-none focus:border-accent/60 text-sm" />
                <button onClick={search} disabled={searching} className="bg-white/10 hover:bg-white/15 rounded-xl px-4 disabled:opacity-50">
                    {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                </button>
            </div>
            <div className="mt-3 max-h-[45vh] overflow-y-auto space-y-1">
                {results.map(v => (
                    <button key={v.videoId} onClick={() => pick(v)}
                        className="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/10 text-left">
                        {v.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.thumb} alt="" className="w-14 h-9 rounded-lg object-cover shrink-0" />
                        ) : <div className="w-14 h-9 rounded-lg bg-white/5 shrink-0" />}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{v.title}</p>
                            <p className="text-[11px] text-white/40 truncate">{v.channel} · {formatDuration(v.durationMs)}</p>
                        </div>
                    </button>
                ))}
            </div>
        </Modal>
    );
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={close}>
            <div className="glass bg-zinc-900/90 rounded-3xl w-full max-w-lg p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold truncate pr-4">{title}</h2>
                    <button onClick={close} className="text-white/50 hover:text-white"><X size={18} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}
