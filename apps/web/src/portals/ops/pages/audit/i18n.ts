import { registerDictionary } from '@/i18n';
import '@/portals/ops/components/opsb/i18n';

registerDictionary({
  'ops.audit.title': { en: 'Audit log', ar: 'سجل التدقيق' },
  'ops.audit.subtitle': { en: 'Every change made by staff, brands, heroes, integrations and the system', ar: 'كل تغيير قام به الموظفون أو التجار أو المناديب أو التكاملات أو النظام' },
  'ops.audit.entity': { en: 'Entity', ar: 'الكيان' },
  'ops.audit.allEntities': { en: 'All entities', ar: 'كل الكيانات' },
  'ops.audit.entityId': { en: 'Entity ID', ar: 'معرّف الكيان' },
  'ops.audit.actor': { en: 'Actor', ar: 'المنفّذ' },
  'ops.audit.allActors': { en: 'Anyone', ar: 'أي شخص' },
  'ops.audit.action': { en: 'Action', ar: 'الإجراء' },
  'ops.audit.actionHint': { en: 'Exact action or a prefix ending with "." e.g. brand.', ar: 'إجراء محدد أو بادئة تنتهي بـ "." مثل brand.' },
  'ops.audit.search': { en: 'Search actions', ar: 'ابحث في الإجراءات' },
  'ops.audit.empty': { en: 'No audit entries match', ar: 'لا توجد سجلات مطابقة' },
  'ops.audit.details': { en: 'Change details', ar: 'تفاصيل التغيير' },
  'ops.audit.ip': { en: 'IP address', ar: 'عنوان IP' },
  'ops.audit.ua': { en: 'Device', ar: 'الجهاز' },
  'ops.audit.actorType.SYSTEM': { en: 'System', ar: 'النظام' },
  'ops.audit.actorType.STAFF': { en: 'Staff', ar: 'موظف' },
  'ops.audit.actorType.BRAND': { en: 'Brand', ar: 'تاجر' },
  'ops.audit.actorType.COURIER': { en: 'Hero', ar: 'مندوب' },
  'ops.audit.actorType.CUSTOMER': { en: 'Customer', ar: 'عميل' },
  'ops.audit.actorType.API': { en: 'API key', ar: 'مفتاح API' },
  'ops.audit.actorType.INTEGRATION': { en: 'Integration', ar: 'تكامل' },
  'ops.audit.filterEntity': { en: 'Show all changes to this record', ar: 'عرض كل التغييرات على هذا السجل' },
});
