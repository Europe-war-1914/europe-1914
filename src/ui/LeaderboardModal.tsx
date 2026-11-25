import { useEffect, useState } from 'react';
import { Crown, Medal, Trophy, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LeaderboardRow {
  id: string;
  username: string;
  elo: number;
  wins: number;
  games_played: number;
  is_commander: boolean;
}

interface LeaderboardModalProps {
  currentUserId?: string;
  onClose: () => void;
}

export function LeaderboardModal({ currentUserId, onClose }: LeaderboardModalProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError('Base de données non configurée.');
      return;
    }

    const client = supabase;
    let cancelled = false;

    const fetchTop = async () => {
      setLoading(true);
      const { data, error: queryError } = await client
        .from('profiles')
        .select('id, username, elo, wins, games_played, is_commander')
        .order('elo', { ascending: false })
        .order('wins', { ascending: false })
        .limit(20);

      if (cancelled) return;
      setLoading(false);

      if (queryError) {
        setError('Impossible de charger le classement.');
        return;
      }

      setRows((data ?? []) as LeaderboardRow[]);
    };

    void fetchTop();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm font-sans overflow-y-auto">
      <div className="relative my-auto w-full max-w-xl rounded-xl border border-amber-400/40 bg-stone-900 p-5 sm:p-6 text-amber-50 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white"
          title="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-amber-400">
          <Trophy className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-widest">
            État-Major Européen • Top 20
          </span>
        </div>

        <h2 className="mt-1 font-serif text-2xl font-bold text-amber-100">
          Classement Mondial ELO
        </h2>
        <p className="mt-0.5 text-xs text-stone-400">
          Gagnez des points ELO en éliminant vos rivaux et en conquérant leurs capitales.
        </p>

        <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-lg border border-stone-800 bg-stone-950/80">
          {loading ? (
            <p className="py-10 text-center text-xs text-stone-400">
              Chargement du classement...
            </p>
          ) : error ? (
            <p className="py-10 text-center text-xs text-red-300">{error}</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-stone-400">
              Aucun commandant classé pour l’instant. Lancez une partie en ligne !
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-stone-800 bg-stone-900/90 text-[11px] uppercase tracking-wider text-stone-400">
                <tr>
                  <th className="px-3 py-2.5">Rang</th>
                  <th className="px-3 py-2.5">Commandant</th>
                  <th className="px-3 py-2.5 text-right">Victoires</th>
                  <th className="px-3 py-2.5 text-right">ELO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/70">
                {rows.map((row, idx) => {
                  const rank = idx + 1;
                  const isMe = row.id === currentUserId;
                  const winRate =
                    row.games_played > 0
                      ? Math.round((row.wins / row.games_played) * 100)
                      : 0;

                  return (
                    <tr
                      key={row.id}
                      className={
                        isMe
                          ? 'bg-amber-950/40 text-amber-100'
                          : 'text-stone-200 hover:bg-stone-900/50'
                      }
                    >
                      <td className="px-3 py-2.5 font-mono font-bold">
                        {rank === 1 ? (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <Medal className="h-3.5 w-3.5" /> #1
                          </span>
                        ) : rank === 2 ? (
                          <span className="text-slate-300">#2</span>
                        ) : rank === 3 ? (
                          <span className="text-amber-600">#3</span>
                        ) : (
                          <span className="text-stone-500">#{rank}</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">
                            {row.username}
                            {isMe ? ' (Vous)' : ''}
                          </span>
                          {row.is_commander && (
                            <span className="inline-flex items-center gap-0.5 rounded border border-amber-400/40 bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              <Crown className="h-2.5 w-2.5" />
                              Commandant
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-2.5 text-right font-mono text-stone-400">
                        {row.wins}/{row.games_played}{' '}
                        <span className="text-[10px] text-stone-500">({winRate}%)</span>
                      </td>

                      <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                        {row.elo}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}