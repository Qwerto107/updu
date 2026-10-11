import type { TLSCertificate } from '$lib/api/certificates';

export type CertificateVerification = 'verified' | 'unverified' | 'expired' | 'not_yet_valid' | 'untrusted' | 'unknown';

// 公开状态页使用独立的数据类型，避免意外带出 SAN、序列号或内部诊断信息。
export interface PublicTLSCertificate {
    id: string;
    domain: string;
    issuer: string;
    valid_from: string;
    valid_until: string;
    last_verified_at: string;
    service_name?: string;
    verification_status: CertificateVerification;
}

export type CertificateDisplay = TLSCertificate | PublicTLSCertificate;
export type CertificateRisk = 'expired' | 'critical' | 'soon' | 'healthy' | 'review';
export type CertificateTone = 'danger' | 'warning' | 'positive' | 'neutral';

export function certificateExpiry(certificate: CertificateDisplay, now = Date.now()) {
    const expiresAt = Date.parse(certificate.valid_until);
    const startsAt = Date.parse(certificate.valid_from);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
        return { risk: 'review' as CertificateRisk, tone: 'neutral' as CertificateTone, label: 'No data', days: 0, expiresAt, order: 4 };
    }
    const remaining = expiresAt - now;
    if (remaining <= 0) {
        return { risk: 'expired' as CertificateRisk, tone: 'danger' as CertificateTone, label: 'Expired', days: 0, expiresAt, order: 0 };
    }
    if (Number.isFinite(startsAt) && startsAt > now) {
        return { risk: 'review' as CertificateRisk, tone: 'warning' as CertificateTone, label: 'Not yet valid', days: 0, expiresAt, order: 1 };
    }
    // 后端保存的 days_remaining 会变旧且不足一天会取整为零，必须按有效期现算。
    const days = Math.ceil(remaining / 86_400_000);
    const risk: CertificateRisk = remaining <= 14 * 86_400_000 ? 'critical' : remaining <= 30 * 86_400_000 ? 'soon' : 'healthy';
    const tone: CertificateTone = risk === 'critical' ? 'danger' : risk === 'soon' ? 'warning' : 'positive';
    return { risk, tone, label: remaining < 86_400_000 ? 'Less than 1 day' : '{count} days remaining', days, expiresAt, order: risk === 'critical' ? 2 : risk === 'soon' ? 3 : 5 };
}

export function certificateVerification(certificate: CertificateDisplay): CertificateVerification {
    // 历史字段 ocsp_status 存储的是握手验证结果，并不代表真正的 OCSP 吊销查询。
    const raw = ('verification_status' in certificate ? certificate.verification_status : certificate.ocsp_status ?? '').trim().toLowerCase();
    if (raw === 'not yet valid' || raw === 'not_yet_valid') return 'not_yet_valid';
    if (raw.startsWith('untrusted')) return 'untrusted';
    if (raw === 'verified' || raw === 'unverified' || raw === 'expired') return raw;
    return 'unknown';
}

export const verificationLabels: Record<CertificateVerification, string> = {
    verified: 'Verified', unverified: 'Unverified', expired: 'Expired',
    not_yet_valid: 'Not yet valid', untrusted: 'Untrusted', unknown: 'No data',
};
