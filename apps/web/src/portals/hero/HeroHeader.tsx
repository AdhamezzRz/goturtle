import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui';

/** Top bar of the hero app (the hero agent extends it with availability toggle & cash meter). */
export function HeroHeader() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <div className="flex items-center gap-3">
      <Avatar name={me.name} src={me.avatarUrl} size={40} className="ring-2 ring-white/40" />
      <div className="min-w-0">
        <p className="truncate text-base font-bold">{me.name}</p>
        <p className="text-xs text-turtle-100/80">{me.courier?.code}</p>
      </div>
    </div>
  );
}
