import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  MessageSquare, Send, Trash2, X, Clock, User, AlertCircle, RefreshCw
} from 'lucide-react';

/**
 * The shift chat. Phase 36: managers, admins and shift leads (canNotify) get a tick box,
 * "Also send it to everyone booked on this shift", which sends the message as a notification too.
 */
export default function ShiftBoard({ shiftId, currentUserRole, shiftTitle, onClose, canNotify = null }) {
  const { user } = useAuth();
  const effectiveRole = currentUserRole || user?.role;
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  const isManagerOrAdmin = ['venue_manager', 'platform_admin', 'super_admin'].includes(effectiveRole);
  const mayNotify = canNotify === null ? isManagerOrAdmin : !!canNotify;    // Phase 36
  const [notifyAll, setNotifyAll] = useState(false);

  const fetchMessages = async () => {
    if (!shiftId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/shifts/${shiftId}/messages`);
      setMessages(res.data || []);
    } catch (err) {
      console.error('Error fetching shift board messages:', err);
      setError(err.response?.data?.detail || "Couldn't load the chat. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [shiftId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    try {
      setSending(true);
      setError(null);
      const res = await api.post(`/shifts/${shiftId}/messages`, {
        content: newMessage.trim(),
        notify: mayNotify && notifyAll,          // Phase 36
      });
      setMessages((prev) => [...prev, res.data]);
      setNewMessage('');
      setNotifyAll(false);
    } catch (err) {
      console.error('Error sending message:', err);
      setError(err.response?.data?.detail || "Couldn't send your message. Try again.");
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId) => {
    try {
      await api.delete(`/messages/${messageId}`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err) {
      console.error('Error deleting message:', err);
      setError(err.response?.data?.detail || "Couldn't delete that message. Try again.");
    }
  };

  return (
    <div className="flex flex-col h-[520px] max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white leading-none">
              Shift chat
            </h3>
            {shiftTitle && (
              <p className="text-xs text-slate-400 mt-1 truncate max-w-xs sm:max-w-md">
                {shiftTitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={fetchMessages}
            title="Refresh messages"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="px-4 py-2 bg-rose-950/80 border-b border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="underline text-[10px]">
            Dismiss
          </button>
        </div>
      )}

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/30">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Loading chat…
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
            <MessageSquare className="w-8 h-8 opacity-40" />
            <p className="text-xs">No messages yet on this shift board.</p>
            <p className="text-[11px] text-slate-600">
              Coordinate logistics, uniforms, or announcements here.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.author_id === user?.id;
            const authorRole = msg.author?.role;
            const isAuthorManager = ['venue_manager', 'platform_admin', 'super_admin'].includes(authorRole);

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group`}
              >
                <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 mb-1 px-1">
                  <span className="font-semibold text-slate-300">
                    {msg.author ? `${msg.author.first_name} ${msg.author.last_name || ''}`.trim() : 'Member'}
                  </span>
                  {isAuthorManager && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">
                      Manager
                    </span>
                  )}
                  <span>•</span>
                  <span>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>

                  {isManagerOrAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMessage(msg.id)}
                      title="Delete message as manager"
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition ml-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div
                  className={`px-3.5 py-2 rounded-2xl text-xs max-w-[85%] break-words shadow-sm ${
                    isMe
                      ? 'bg-emerald-600 text-white rounded-br-none'
                      : isAuthorManager
                      ? 'bg-slate-800 text-slate-100 border border-amber-500/20 rounded-bl-none'
                      : 'bg-slate-800 text-slate-200 border border-slate-700/60 rounded-bl-none'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Phase 36: managers and shift leads can push the message to everyone booked */}
      {mayNotify && (
        <label className="px-4 pt-2.5 bg-slate-950 border-t border-slate-800 flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={notifyAll} onChange={(e) => setNotifyAll(e.target.checked)} className="accent-indigo-500" />
          Also send it to everyone booked on this shift
        </label>
      )}

      {/* Compose Form */}
      <form
        onSubmit={handleSendMessage}
        className={`p-3 bg-slate-950 flex items-center space-x-2 ${mayNotify ? '' : 'border-t border-slate-800'}`}
      >
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type message to shift team..."
          className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!newMessage.trim() || sending}
          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition disabled:opacity-40 flex items-center space-x-1 shadow-md shadow-indigo-600/20"
        >
          <Send className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{sending ? 'Posting...' : (mayNotify && notifyAll ? 'Post & send' : 'Post')}</span>
        </button>
      </form>
    </div>
  );
}
