'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiClientError } from '@/lib/apiClient';
import type { CustomerProfile } from '@/lib/account';
import { AddressFields, EMPTY_ADDRESS, type AddressFieldsValue } from '@/components/checkout/AddressFields';
import { Button } from '@/components/admin/Button';

/**
 * Delivery address book (02-customer §2.2/§2.6). A customer has one saved
 * address — the row checkout reads — so this edits that address in place.
 */
export function AddressForm() {
  const router = useRouter();
  // `null` until the saved address has loaded, so AddressFields mounts once
  // with the real values and can preselect its dropdowns.
  const [value, setValue] = useState<AddressFieldsValue | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<CustomerProfile>('/api/customer/auth/me')
      .then((p) =>
        setValue({
          ...EMPTY_ADDRESS,
          division: p.division,
          district: p.district,
          areaUnitType: p.area_unit_type,
          areaUnitName: p.area_unit_name,
          wardUnitType: p.ward_unit_type,
          wardUnitName: p.ward_unit_name,
          detailedAddress: p.detailed_address,
          postalCode: p.postal_code ?? '',
        }),
      )
      .catch((err: unknown) => {
        if (err instanceof ApiClientError && err.status === 401) {
          router.push('/auth/login');
          return;
        }
        setLoadError('Could not load your address.');
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!value) return;
    setMessage(null);

    const nextErrors: Record<string, string> = {};
    if (!value.division) nextErrors.division = 'Select a division.';
    if (!value.district) nextErrors.district = 'Select a district.';
    if (!value.areaUnitName.trim()) nextErrors.areaUnit = 'Upazila / Thana is required.';
    if (!value.wardUnitName.trim()) nextErrors.wardUnit = 'Union / Ward is required.';
    if (!value.detailedAddress.trim()) nextErrors.detailedAddress = 'Detailed address is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await apiPut<CustomerProfile>('/api/customer/auth/address', {
        division: value.division,
        district: value.district,
        area_unit: {
          type: value.areaUnitType,
          name: value.areaUnitName.trim(),
        },
        ward_unit: {
          type: value.wardUnitType,
          name: value.wardUnitName.trim(),
        },
        detailed_address: value.detailedAddress.trim(),
        postal_code: value.postalCode.trim() || null,
      });
      setMessage({
        kind: 'success',
        text: 'Address saved. It will be used at checkout.',
      });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ApiClientError ? err.message : 'Could not save your address. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-error">
        {loadError}
      </p>
    );
  }
  if (!value) return <p className="text-sm text-text-secondary">Loading your address…</p>;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      <AddressFields value={value} onChange={setValue} errors={errors} hideContactFields />

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mb-lg text-sm ${message.kind === 'error' ? 'text-error' : 'text-accent'}`}
        >
          {message.text}
        </p>
      )}

      <Button type="submit" loading={saving}>
        Save Address
      </Button>
    </form>
  );
}
