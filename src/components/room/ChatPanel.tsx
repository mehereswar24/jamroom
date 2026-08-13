'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { api, publishEphemeral } from '@/hooks/api';
import { EV } from '@/lib/channels';
import { getSavedNickname } from '@/hooks/useLocalIdentity';
import { useRoomStore } from '@/hooks/useRoomStore';
import { avatarColorFor } from '@/lib/ids';

export default function ChatPanel() {
    const messages = useRoomStore(s => s.messages);
    const typing = useRoomStore(s => s.typing);
    const selfClientId = useRoomStore(s => s.selfClientId);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const typingSentRef = useRef(false);
    const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const send = () => {
        const body = draft.trim();
        if (!body) return;
        void api.chat(body).then(res => { if (!res.ok) setError(res.error); });
        setDraft('');
        setError(null);
        stopTyping();
    };

    const stopTyping = () => {
        if (typingSentRef.current) {
            typingSentRef.current = false;
            publishEphemeral(EV.chatTyping, { nickname: getSavedNickname(), isTyping: false });
        }
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };

    const onType = (v: string) => {
        setDraft(v);
        if (!typingSentRef.current && v.trim()) {
            typingSentRef.current = true;
            publishEphemeral(EV.chatTyping, { nickname: getSavedNickname(), isTyping: true });
        }
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(stopTyping, 2500);
    };

    const typers = Object.entries(typing).filter(([cid]) => cid !== selfClientId).map(([, n]) => n);

    return (
        <div className="h-full flex flex-col">
            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
                {messages.map(m => m.type === 'system' ? (
                    <p key={m.id} className="text-center text-[11px] text-white/35">{m.body}</p>
                ) : (
                    <div key={m.id} className={`flex gap-2.5 ${m.clientId === selfClientId ? 'flex-row-reverse' : ''}`}>
                        <div
                            className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-0.5"
                            style={{ backgroundColor: m.clientId ? avatarColorFor(m.clientId) : '#666' }}
                        >
                            {m.nickname.slice(0, 1).toUpperCase()}
                        </div>
                        <div className={`max-w-[75%] ${m.clientId === selfClientId ? 'text-right' : ''}`}>
                            <p className="text-[11px] text-white/40 mb-0.5">{m.nickname}</p>
                            <div className={`inline-block rounded-2xl px-3.5 py-2 text-sm break-words text-left ${
                                m.clientId === selfClientId ? 'bg-white text-black font-semibold shadow' : 'bg-white/10 text-white border border-white/10'
                            }`}>
                                {m.body}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {typers.length > 0 && (
                <p className="px-4 pb-1 text-[11px] text-white/40">
                    {typers.slice(0, 2).join(', ')}{typers.length > 2 ? ` +${typers.length - 2}` : ''} typing…
                </p>
            )}
            {error && <p className="px-4 pb-1 text-[11px] text-white font-medium">{error}</p>}

            <div className="p-3 border-t border-white/10 flex gap-2">
                <input
                    value={draft}
                    onChange={e => onType(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="Say something…"
                    maxLength={500}
                    className="flex-1 bg-black/60 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white"
                />
                <button onClick={send} className="bg-white hover:bg-slate-200 text-black rounded-xl px-4 transition-all cursor-pointer font-bold shrink-0">
                    <SendHorizonal size={16} />
                </button>
            </div>
        </div>
    );
}
