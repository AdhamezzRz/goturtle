import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreVertical, Pencil, Plus, Search, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { STAFF_ROLES, UserStatus } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, num } from '@/lib/format';
import { useDebounced, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, IconButton, Input, Menu, Modal, PageHeader, Pagination, Select, StateBadge, type Column } from '@/components/ui';
import './i18n';
import { FilterBar, FilterField, Notice, RequirePermission, Stat, StatGrid, TempPasswordPanel, apiFieldErrors, useForm, useHubName, useHubs, v, type Errors } from '@/portals/ops/components/opsb';


type StaffUser = { id: string; name: string; email: string | null; phone: string; role: string; status: string; locale: 'ar' | 'en'; avatarUrl: string | null; hubId: string | null; lastLoginAt: string | null; invitePending: boolean; hub: { id: string; name: string } | null };

const count = (status?: string) => api<Paginated<StaffUser>>('/users', { query: { kind: 'staff', status, pageSize: 1 } }).then((r) => r.meta.total);

export default function UsersPage() {
  return (
    <RequirePermission permission="users.read">
      <UsersInner />
    </RequirePermission>
  );
}

function UsersInner() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const hubs = useHubs();
  const hubName = useHubName();
  const [f, setF] = useQueryState({ q: '', role: '', status: '', hubId: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q, 350);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const [edit, setEdit] = useState<StaffUser | 'new' | null>(null);
  const [act, setAct] = useState<{ kind: 'reset' | 'suspend' | 'reactivate'; u: StaffUser } | null>(null);
  const [secret, setSecret] = useState<{ name: string; phone: string; password: string; title: string } | null>(null);
  const list = useQuery({
    queryKey: ['users', 'list', f],
    queryFn: () => api<Paginated<StaffUser>>('/users', { query: { kind: 'staff', q: f.q, role: f.role, status: f.status, hubId: f.hubId, page: f.page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const stats = useQuery({ queryKey: ['users', 'stats'], queryFn: async () => { const [all, a, s] = await Promise.all([count(), count('ACTIVE'), count('SUSPENDED')]); return { all, a, s }; } });
  const manage = can('users.manage');
  const action = useMutation({
    mutationFn: ({ kind, u }: { kind: 'reset' | 'suspend' | 'reactivate'; u: StaffUser }) => api<{ temporaryPassword?: string }>(`/users/${u.id}/${kind === 'reset' ? 'reset-password' : kind}`, { method: 'POST' }),
    onSuccess: (r, vars) => {
      toast.success(t('ops.users.done'));
      setAct(null);
      qc.invalidateQueries({ queryKey: ['users'] });
      if (vars.kind === 'reset' && r?.temporaryPassword) setSecret({ name: vars.u.name, phone: vars.u.phone, password: r.temporaryPassword, title: t('ops.users.newPassword') });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const menu = (u: StaffUser) =>
    manage ? (
      <div onClick={(e) => e.stopPropagation()}>
        <Menu
          trigger={<IconButton label={t('common.actions')} icon={<MoreVertical className="h-4 w-4" />} />}
          items={[
            { label: t('ops.users.edit'), icon: <Pencil className="h-4 w-4" />, onClick: () => setEdit(u) },
            { label: t('ops.users.reset'), icon: <KeyRound className="h-4 w-4" />, onClick: () => setAct({ kind: 'reset', u }) },
            { label: t('ops.users.suspend'), icon: <UserX className="h-4 w-4" />, onClick: () => setAct({ kind: 'suspend', u }), danger: true, hidden: u.status === 'SUSPENDED' || u.id === me?.id },
            { label: t('ops.users.reactivate'), icon: <UserCheck className="h-4 w-4" />, onClick: () => setAct({ kind: 'reactivate', u }), hidden: u.status !== 'SUSPENDED' },
          ]}
        />
      </div>
    ) : null;
  const columns: Column<StaffUser>[] = [
    { key: 'user', header: t('common.name'), cell: (u) => <div className="flex min-w-[180px] items-center gap-3"><Avatar name={u.name} src={u.avatarUrl} size={36} /><div className="min-w-0"><p className="truncate font-semibold text-ink-900 dark:text-ink-50">{u.name}{u.id === me?.id && <Badge tone="info" className="ms-2">{t('ops.users.you')}</Badge>}</p><p className="ltr text-start text-xs text-ink-500">{u.phone}{u.email ? ` · ${u.email}` : ''}</p></div></div> },
    { key: 'role', header: t('ops.users.role'), cell: (u) => <Badge tone={u.role === 'SUPER_ADMIN' ? 'progress' : 'info'}>{u.role === 'SUPER_ADMIN' && <ShieldCheck className="h-3 w-3" />}{t(`role.${u.role}`)}</Badge> },
    { key: 'hub', header: t('common.hub'), cell: (u) => (u.hubId ? hubName(u.hubId, u.hub?.name) : '—'), hideBelow: 'lg' },
    { key: 'status', header: t('common.status'), cell: (u) => <StateBadge value={u.status} /> },
    { key: 'login', header: t('ops.users.lastLogin'), cell: (u) => <span className="text-sm text-ink-500">{u.lastLoginAt ? ago(u.lastLoginAt) : t('ops.users.never')}</span>, hideBelow: 'md' },
    { key: 'act', header: '', align: 'end', cell: menu },
  ];
  return (
    <div>
      <PageHeader title={t('ops.users.title')} subtitle={t('ops.users.subtitle')} actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('ops.users.invite')}</Button>} />
      <StatGrid cols={3} className="mb-5">
        <Stat icon={<Users />} tone="ink" label={t('ops.users.kpi.total')} value={num(stats.data?.all)} loading={stats.isLoading} onClick={() => setF({ status: '' })} active={!f.status} />
        <Stat icon={<UserCheck />} label={t('ops.users.kpi.active')} value={num(stats.data?.a)} loading={stats.isLoading} onClick={() => setF({ status: 'ACTIVE' })} active={f.status === 'ACTIVE'} />
        <Stat icon={<UserX />} tone="red" label={t('ops.users.kpi.suspended')} value={num(stats.data?.s)} loading={stats.isLoading} onClick={() => setF({ status: 'SUSPENDED' })} active={f.status === 'SUSPENDED'} />
      </StatGrid>
      <FilterBar
        search={<Input type="search" leading={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ops.users.search')} aria-label={t('action.search')} />}
        activeCount={[f.role, f.status, f.hubId].filter(Boolean).length}
        onClear={() => setF({ role: '', status: '', hubId: '' })}
      >
        <FilterField label={t('ops.users.role')}><Select value={f.role} onChange={(e) => setF({ role: e.target.value })} placeholder={t('ops.users.allRoles')} options={STAFF_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} aria-label={t('ops.users.role')} /></FilterField>
        <FilterField label={t('common.status')}><Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={Object.values(UserStatus).map((s) => ({ value: s, label: t(`state.${s}`) }))} aria-label={t('common.status')} /></FilterField>
        <FilterField label={t('common.hub')}><Select value={f.hubId} onChange={(e) => setF({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} aria-label={t('common.hub')} /></FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(u) => u.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={manage ? (u) => setEdit(u) : undefined}
        empty={<EmptyState icon={<Users className="h-7 w-7" />} title={t('ops.users.empty')} />}
        mobileCard={(u) => (
          <div className="flex items-start gap-3">
            <Avatar name={u.name} src={u.avatarUrl} size={40} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{u.name}</p>{menu(u)}</div>
              <p className="ltr text-start text-xs text-ink-500">{u.phone}</p>
              <div className="flex flex-wrap items-center gap-2">{columns[1].cell(u)}<StateBadge value={u.status} /><span className="text-xs text-ink-400">{u.lastLoginAt ? ago(u.lastLoginAt) : t('ops.users.never')}</span></div>
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <UserModal open={!!edit} user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onInvited={(name, phone, password) => setSecret({ name, phone, password, title: t('ops.opsb.tempPassword') })} />
      <ConfirmDialog
        open={!!act}
        onClose={() => setAct(null)}
        onConfirm={() => act && action.mutate(act)}
        loading={action.isPending}
        danger={act?.kind !== 'reactivate'}
        title={act ? t(`ops.users.${act.kind}Title`, { name: act.u.name }) : ''}
        description={act?.kind === 'reset' ? t('ops.users.resetDesc') : act?.kind === 'suspend' ? t('ops.users.suspendDesc') : undefined}
        confirmLabel={act ? t(`ops.users.${act.kind}`) : undefined}
      />
      <Modal open={!!secret} onClose={() => setSecret(null)} title={secret?.name} footer={<Button onClick={() => setSecret(null)}>{t('action.close')}</Button>}>
        {secret && <TempPasswordPanel password={secret.password} loginId={secret.phone} title={secret.title} />}
      </Modal>
    </div>
  );
}

function UserModal({ open, user, onClose, onInvited }: { open: boolean; user: StaffUser | null; onClose: () => void; onInvited: (name: string, phone: string, password: string) => void }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const hubs = useHubs();
  const blank = { name: '', phone: '', email: '', role: 'DISPATCHER', hubId: '', locale: 'ar', status: 'ACTIVE' };
  const { values: f, set, errors, setErrors, reset } = useForm(blank);
  useEffect(() => {
    if (open) reset(user ? { name: user.name, phone: user.phone, email: user.email ?? '', role: user.role, hubId: user.hubId ?? '', locale: user.locale, status: user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);
  const self = user?.id === me?.id;
  const roles = STAFF_ROLES.filter((r) => r !== 'SUPER_ADMIN' || me?.role === 'SUPER_ADMIN');
  const m = useMutation({
    mutationFn: () =>
      user
        ? api(`/users/${user.id}`, { method: 'PATCH', body: { name: f.name.trim(), email: f.email.trim() || null, role: self ? undefined : f.role, hubId: f.hubId || null, locale: f.locale, status: self ? undefined : f.status } })
        : api<{ user: StaffUser; temporaryPassword: string }>('/users', { method: 'POST', body: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, role: f.role, hubId: f.hubId || undefined, locale: f.locale } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['opsb', 'staff-options'] });
      const inv = r as { user?: StaffUser; temporaryPassword?: string } | undefined;
      if (!user && inv?.user && inv.temporaryPassword) {
        toast.success(t('ops.users.invited', { name: f.name }));
        onInvited(inv.user.name, inv.user.phone, inv.temporaryPassword);
      } else toast.success(t('ops.users.done'));
      onClose();
    },
    onError: (e) => {
      setErrors(apiFieldErrors(e, ['name', 'phone', 'email', 'role', 'hubId'], { PHONE_TAKEN: 'phone', INVALID_PHONE: 'phone', EMAIL_TAKEN: 'email', INVALID_HUB: 'hubId', FORBIDDEN_ROLE: 'role', LAST_SUPER_ADMIN: 'role', SELF_LOCKOUT: 'role' }));
      toast.error(errorMessage(e));
    },
  });
  const submit = () => {
    const e: Errors = {};
    if (f.name.trim().length < 2) e.name = t('ops.opsb.minChars', { n: 2 });
    if (!user && !v.phone(f.phone)) e.phone = t('ops.opsb.invalidPhone');
    if (f.email && !v.email(f.email)) e.email = t('ops.opsb.invalidEmail');
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title={user ? t('ops.users.edit') : t('ops.users.inviteTitle')}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{user ? t('action.save') : t('ops.users.invite')}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} required error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} maxLength={120} />}</Field>
        <Field label={t('common.phone')} required={!user} error={errors.phone}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.phone} disabled={!!user} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} maxLength={20} />}</Field>
        <Field label={t('common.email')} error={errors.email} className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} maxLength={191} />}</Field>
        <Field label={t('ops.users.role')} required error={errors.role}>{(id) => <Select id={id} value={f.role} disabled={self || (user?.role === 'SUPER_ADMIN' && me?.role !== 'SUPER_ADMIN')} onChange={(e) => set('role', e.target.value)} options={(user?.role === 'SUPER_ADMIN' && !roles.includes('SUPER_ADMIN') ? [...roles, 'SUPER_ADMIN' as const] : roles).map((r) => ({ value: r, label: t(`role.${r}`) }))} />}</Field>
        <Field label={t('common.hub')} hint={t('ops.users.hubHint')} error={errors.hubId}>{(id) => <Select id={id} value={f.hubId} onChange={(e) => set('hubId', e.target.value)} placeholder={t('ops.users.noHub')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} />}</Field>
        <Field label={t('ops.users.locale')}>{(id) => <Select id={id} value={f.locale} onChange={(e) => set('locale', e.target.value)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />}</Field>
        {user && <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} disabled={self} onChange={(e) => set('status', e.target.value)} options={['ACTIVE', 'SUSPENDED'].map((s) => ({ value: s, label: t(`state.${s}`) }))} />}</Field>}
        {(f.role === 'SUPER_ADMIN' || user?.role === 'SUPER_ADMIN') && <Notice tone="info" className="sm:col-span-2">{t('ops.users.superAdminNote')}</Notice>}
      </div>
    </Modal>
  );
}
