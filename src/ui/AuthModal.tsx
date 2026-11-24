import { useState, type FormEvent } from 'react';
import { Lock, Mail, User, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase n’est pas configuré.');
      return;
    }

    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        const cleanName = username.trim() || 'Commandant';
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { username: cleanName },
          },
        });

        if (signUpError) {
          setError(signUpError.message);
        } else if (data.session) {
          onSuccess();
          onClose();
        } else {
          setInfo(
            'Compte créé ! Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.'
          );
          setMode('login');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) {
          setError('Email ou mot de passe incorrect.');
        } else {
          onSuccess();
          onClose();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm font-sans">
      <div className="relative w-full max-w-md rounded-xl border border-amber-400/40 bg-stone-900 p-5 sm:p-6 text-amber-50 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white"
          title="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="font-serif text-xl font-bold text-amber-100">
          {mode === 'login' ? 'Connexion État-Major' : 'Créer un compte Commandant'}
        </h2>
        <p className="mt-1 text-xs text-stone-400">
          Sauvegardez votre classement ELO, vos victoires et vos packs débloqués.
        </p>

        {/* Onglets Connexion / Inscription */}
        <div className="mt-4 grid grid-cols-2 rounded-lg border border-stone-700 bg-stone-950 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`rounded-md py-2 transition ${
              mode === 'login'
                ? 'bg-amber-600 text-stone-950'
                : 'text-stone-400 hover:text-amber-100'
            }`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`rounded-md py-2 transition ${
              mode === 'signup'
                ? 'bg-amber-600 text-stone-950'
                : 'text-stone-400 hover:text-amber-100'
            }`}
          >
            Inscription
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-amber-200">
                Nom de commandant
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-500" />
                <input
                  type="text"
                  required
                  maxLength={18}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ex. Maréchal Foch"
                  className="w-full rounded-lg border border-stone-700 bg-stone-950 py-2 pl-9 pr-3 text-sm text-amber-50 focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-amber-200">
              Adresse email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="commandant@exemple.fr"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 py-2 pl-9 pr-3 text-sm text-amber-50 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-amber-200">
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-500" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6 caractères minimum"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 py-2 pl-9 pr-3 text-sm text-amber-50 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="rounded border border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}

          {info && (
            <p className="rounded border border-emerald-500/40 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-200">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-amber-600 py-2.5 font-serif text-sm font-bold text-stone-950 transition hover:bg-amber-500 disabled:opacity-50"
          >
            {loading
              ? 'Chargement...'
              : mode === 'login'
              ? 'Se connecter'
              : 'Créer mon compte'}
          </button>
        </form>
      </div>
    </div>
  );
}