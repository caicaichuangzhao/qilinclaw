import { ref, computed } from 'vue';
import zh from './zh';
import en from './en';

export type Locale = 'zh' | 'en';

const messages: Record<Locale, Record<string, any>> = { zh, en };

const storedLocale = (typeof localStorage !== 'undefined' ? localStorage.getItem('qilinclaw-locale') : null) as Locale | null;
const locale = ref<Locale>(storedLocale || 'zh');

function getNestedValue(obj: any, path: string): string {
    return path.split('.').reduce((o, k) => o?.[k], obj) ?? path;
}

export function useI18n() {
    const t = (key: string, params?: Record<string, string | number>): string => {
        let text = getNestedValue(messages[locale.value], key);
        if (typeof text !== 'string') return key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(`{${k}}`, String(v));
            }
        }
        return text;
    };

    const setLocale = (lang: Locale) => {
        locale.value = lang;
        localStorage.setItem('qilinclaw-locale', lang);
    };

    const currentLocale = computed(() => locale.value);

    return { t, locale: currentLocale, setLocale };
}
