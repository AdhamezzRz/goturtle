import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, MoreHorizontal, Pencil, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeEgyptPhone } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, phone } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, IconButton, Input, Menu, Modal, PageHeader, Select, StateBadge, type Column } from '@/components/ui';
import { CopyButton, Ltr } from '../components/common';
import type { TeamMember } from '../components/types';
import './i18n';

export default function TeamPage() {
  const { t } = useI18n();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const manage = can('users.manage');
  const q = useQuery({ queryKey: ['team'], queryFn: () => api<TeamMember[]>('/brands/me/team') });
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<TeamMember | null>(null);
  const [remove, setRemove] = useState<TeamMember | null>(null);
  const [secret, setSecret] = useState<{ name: string; phone: string; password: string } | null>(null);

  const del = useMutation({
    mutationFn: (m: TeamMember) => api(`/brands/me/team/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('brand.team.removed'));
      setRemove(null);
      qc.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<TeamMember>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.name} src={m.avatarUrl} size={36} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900 dark:text-white">{m.name} {m.id === me?.id && <span className="text-xs font-normal text-ink-400">({t('brand.team.you')})</span>}</p>
            <p className="truncate text-xs text-ink-500">{m.email ?? '—'}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: t('common.phone'), hideBelow: 'md', cell: (m) => <Ltr>{phone(m.phone)}</Ltr> },
    { key: 'role', header: t('brand.team.role'), cell: (m) => <Badge tone={m.role === 'BRAND_OWNER' ? 'success' : 'neutral'}>{m.role === 'BRAND_OWNER' && <ShieldCheck className="h-3 w-3" />}{t(`role.${m.role}`)}</Badge> },
    { key: 'status', header: t('common.status'), hideBelow: 'sm', cell: (m) => <StateBadge value={m.invitePending ? 'INVITED' : m.status} /> },
    { key: 'last', header: t('brand.team.lastLogin'), hideBelow: 'lg', cell: (m) => <span className="text-xs text-ink-500">{m.lastLoginAt ? ago(m.lastLoginAt) : t('brand.common.never')}</span> },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (m) =>
        manage && m.id !== me?.id ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu
              trigger={<IconButton label={t('common.actions')} icon={<MoreHorizontal className="h-4 w-4" />} />}
              items={[
                { label: t('brand.team.edit'), icon: <Pencil className="h-4 w-4" />, onClick: () => setEdit(m) },
                { label: t('brand.team.remove'), icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setRemove(m) },
              ]}
            />
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('brand.nav.team')} subtitle={t('brand.team.subtitle')} actions={manage && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInvite(true)}>{t('brand.team.invite')}</Button>} />
      <DataTable
        columns={columns}
        rows={q.data}
        rowKey={(m) => m.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon={<Users className="h-7 w-7" />} title={t('brand.team.empty')} />}
        mobileCard={(m) => (
          <div className="flex items-center gap-3">
            <Avatar name={m.name} src={m.avatarUrl} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink-900 dark:text-white">{m.name}</p>
              <p className="text-xs text-ink-500"><Ltr>{phone(m.phone)}</Ltr> · {t(`role.${m.role}`)}</p>
            </div>
            {columns[5].cell(m)}
          </div>
        )}
      />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <RoleCard role="BRAND_OWNER" />
        <RoleCard role="BRAND_STAFF" />
      </div>

      <MemberModal open={invite || !!edit} member={edit} onClose={() => { setInvite(false); setEdit(null); }} onInvited={(s) => setSecret(s)} />
      <ConfirmDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        onConfirm={() => remove && del.mutate(remove)}
        loading={del.isPending}
        danger
        title={t('brand.team.removeTitle', { name: remove?.name ?? '' })}
        description={t('brand.team.removeBody')}
        confirmLabel={t('brand.team.remove')}
      />
      <Modal open={!!secret} onClose={() => setSecret(null)} title={t('brand.team.invitedTitle')} footer={<Button onClick={() => setSecret(null)}>{t('brand.team.savedIt')}</Button>}>
        {secret && (
          <div className="space-y-4">
            <p className="text-sm text-ink-600 dark:text-ink-300">{t('brand.team.invitedBody', { name: secret.name })}</p>
            <div className="space-y-2 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/60">
              <div className="flex items-center justify-between gap-2 text-sm"><span className="text-ink-500">{t('auth.identifier')}</span><span className="flex items-center gap-1"><Ltr className="font-mono">{phone(secret.phone)}</Ltr><CopyButton value={secret.phone} size="xs" /></span></div>
              <div className="flex items-center justify-between gap-2 text-sm"><span className="text-ink-500">{t('brand.team.tempPassword')}</span><span className="flex items-center gap-1"><Ltr className="font-mono text-base font-bold">{secret.password}</Ltr><CopyButton value={secret.password} size="xs" /></span></div>
            </div>
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('brand.team.onceWarning')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RoleCard({ role }: { role: 'BRAND_OWNER' | 'BRAND_STAFF' }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <p className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white">{role === 'BRAND_OWNER' ? <ShieldCheck className="h-4 w-4 text-turtle-600" /> : <KeyRound className="h-4 w-4 text-ink-400" />}{t(`role.${role}`)}</p>
      <p className="mt-1 text-sm text-ink-500">{t(`brand.team.roleHint.${role}`)}</p>
    </div>
  );
}

function MemberModal({ open, member, onClose, onInvited }: { open: boolean; member: TeamMember | null; onClose: () => void; onInvited: (s: { name: string; phone: string; password: string }) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', phone: '', email: '', role: 'BRAND_STAFF', locale: 'ar', status: 'ACTIVE' });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(member ? { name: member.name, phone: member.phone, email: member.email ?? '', role: member.role, locale: member.locale, status: member.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' } : { name: '', phone: '', email: '', role: 'BRAND_STAFF', locale: 'ar', status: 'ACTIVE' });
  }, [open, member]);
  const errors = {
    name: f.name.trim().length < 2 ? t('brand.new.errName') : undefined,
    phone: !member && !normalizeEgyptPhone(f.phone) ? t('error.INVALID_PHONE') : undefined,
    email: f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? t('brand.team.errEmail') : undefined,
  };
  const valid = !errors.name && !errors.phone && !errors.email;
  const m = useMutation({
    mutationFn: async () => {
      if (member) {
        await api(`/brands/me/team/${member.id}`, { method: 'PATCH', body: { name: f.name.trim(), email: f.email.trim() || null, role: f.role, status: f.status } });
        return null;
      }
      return api<{ user: TeamMember; temporaryPassword: string | null }>('/brands/me/team', { method: 'POST', body: { name: f.name.trim(), phone: f.phone, email: f.email.trim() || undefined, role: f.role, locale: f.locale } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['team'] });
      onClose();
      if (res?.temporaryPassword) onInvited({ name: res.user.name, phone: res.user.phone, password: res.temporaryPassword });
      else toast.success(member ? t('brand.common.saved') : t('brand.team.invitedToast'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    setTouched(true);
    if (valid) m.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title={member ? t('brand.team.edit') : t('brand.team.invite')} description={member ? undefined : t('brand.team.inviteHint')} footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{member ? t('action.save') : t('brand.team.sendInvite')}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={t('common.name')} required error={touched ? errors.name : undefined}>{(id) => <Input id={id} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t('common.phone')} required={!member} error={touched ? errors.phone : undefined} hint={member ? t('brand.team.phoneLocked') : undefined}>
          {(id) => <Input id={id} dir="ltr" type="tel" inputMode="tel" value={member ? phone(f.phone) : f.phone} disabled={!!member} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01X XXXX XXXX" />}
        </Field>
        <Field label={t('common.email')} error={touched ? errors.email : undefined} hint={t('brand.common.optional')}>{(id) => <Input id={id} dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('brand.team.role')}>{(id) => <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={[{ value: 'BRAND_STAFF', label: t('role.BRAND_STAFF') }, { value: 'BRAND_OWNER', label: t('role.BRAND_OWNER') }]} />}</Field>
          {member ? (
            <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'ACTIVE', label: t('state.ACTIVE') }, { value: 'SUSPENDED', label: t('state.SUSPENDED') }]} />}</Field>
          ) : (
            <Field label={t('brand.profile.language')}>{(id) => <Select id={id} value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />}</Field>
          )}
        </div>
        <p className="text-xs text-ink-500">{t(`brand.team.roleHint.${f.role}`)}</p>
      </form>
    </Modal>
  );
}
