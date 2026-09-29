'use client';

import { useEffect, useState } from 'react';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import { fetchDistricts, fetchDivisions, fetchUpazilas, type GeoNode } from '@/lib/geography';

/**
 * Guest/registered delivery-address fields (02-customer §2.2/§2.9.2).
 *
 * Division -> District -> Upazila/Thana cascade from the geography reference
 * API (progressive selects); the submitted values are the plain names the
 * backend stores (`orders.division`/`district`/`area_unit_name` are free
 * text, not geography ids — see `0011_customer_checkout.sql`), matching the
 * cascade only to guide entry, not to constrain storage to a foreign key.
 * Union/Ward has no authoritative source (backend skill §Geography) and
 * stays free text.
 */

export type AddressFieldsValue = {
  fullName: string;
  phoneNumber: string;
  email: string;
  division: string;
  district: string;
  areaUnitType: string;
  areaUnitName: string;
  wardUnitType: string;
  wardUnitName: string;
  detailedAddress: string;
  postalCode: string;
};

export const EMPTY_ADDRESS: AddressFieldsValue = {
  fullName: '',
  phoneNumber: '',
  email: '',
  division: '',
  district: '',
  areaUnitType: 'THANA',
  areaUnitName: '',
  wardUnitType: 'WARD',
  wardUnitName: '',
  detailedAddress: '',
  postalCode: '',
};

export function AddressFields({
  value,
  onChange,
  errors = {},
  hideContactFields = false,
}: {
  value: AddressFieldsValue;
  onChange: (next: AddressFieldsValue) => void;
  errors?: Record<string, string>;
  /** Omits name/phone/email — for the account address book, where those live on the profile. */
  hideContactFields?: boolean;
}) {
  const [divisions, setDivisions] = useState<GeoNode[]>([]);
  const [districts, setDistricts] = useState<GeoNode[]>([]);
  const [upazilas, setUpazilas] = useState<GeoNode[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState('');
  const [selectedDistrictId, setSelectedDistrictId] = useState('');

  useEffect(() => {
    fetchDivisions()
      .then(setDivisions)
      .catch(() => setDivisions([]));
  }, []);

  // Editing a saved address: once the divisions load, preselect the dropdowns
  // that match the stored division/district names (a no-op for an empty form).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || divisions.length === 0) return;
    setPrefilled(true);
    const division = divisions.find((d) => d.name === value.division);
    if (!division) return;
    setSelectedDivisionId(division.id);
    fetchDistricts(division.id)
      .then((list) => {
        setDistricts(list);
        const district = list.find((d) => d.name === value.district);
        if (!district) return;
        setSelectedDistrictId(district.id);
        return fetchUpazilas(district.id).then(setUpazilas);
      })
      .catch(() => undefined);
  }, [divisions, prefilled, value.division, value.district]);

  function set<K extends keyof AddressFieldsValue>(key: K, val: AddressFieldsValue[K]) {
    onChange({ ...value, [key]: val });
  }

  async function handleDivisionChange(divisionId: string) {
    setSelectedDivisionId(divisionId);
    setSelectedDistrictId('');
    setDistricts([]);
    setUpazilas([]);
    const division = divisions.find((d) => d.id === divisionId);
    onChange({
      ...value,
      division: division?.name ?? '',
      district: '',
      areaUnitName: '',
    });
    if (!divisionId) return;
    try {
      setDistricts(await fetchDistricts(divisionId));
    } catch {
      setDistricts([]);
    }
  }

  async function handleDistrictChange(districtId: string) {
    setSelectedDistrictId(districtId);
    setUpazilas([]);
    const district = districts.find((d) => d.id === districtId);
    onChange({ ...value, district: district?.name ?? '', areaUnitName: '' });
    if (!districtId) return;
    try {
      setUpazilas(await fetchUpazilas(districtId));
    } catch {
      setUpazilas([]);
    }
  }

  return (
    <div>
      {!hideContactFields && (
        <>
          <FormField
            label="Full Name"
            id="fullName"
            required
            value={value.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            error={errors.fullName}
          />
          <FormField
            label="Phone Number"
            id="phoneNumber"
            type="tel"
            placeholder="01XXXXXXXXX"
            required
            value={value.phoneNumber}
            onChange={(e) => set('phoneNumber', e.target.value)}
            error={errors.phoneNumber}
          />
          <FormField
            label="Email (optional)"
            id="email"
            type="email"
            value={value.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
          />
        </>
      )}

      <SelectField
        label="Division"
        id="division"
        required
        value={selectedDivisionId}
        onChange={(e) => void handleDivisionChange(e.target.value)}
        error={errors.division}
      >
        <option value="">Select division</option>
        {divisions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="District"
        id="district"
        required
        value={selectedDistrictId}
        onChange={(e) => void handleDistrictChange(e.target.value)}
        disabled={!selectedDivisionId}
        error={errors.district}
      >
        <option value="">Select district</option>
        {districts.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Upazila / Thana type"
        id="areaUnitType"
        required
        value={value.areaUnitType}
        onChange={(e) => set('areaUnitType', e.target.value)}
        error={errors.areaUnitType}
      >
        <option value="THANA">Thana (metropolitan)</option>
        <option value="UPAZILA">Upazila (rural)</option>
      </SelectField>

      {upazilas.length > 0 ? (
        <SelectField
          label="Upazila / Thana"
          id="areaUnitName"
          required
          value={value.areaUnitName}
          onChange={(e) => set('areaUnitName', e.target.value)}
          error={errors.areaUnit}
        >
          <option value="">Select upazila/thana</option>
          {upazilas.map((u) => (
            <option key={u.id} value={u.name}>
              {u.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <FormField
          label="Upazila / Thana"
          id="areaUnitName"
          required
          value={value.areaUnitName}
          onChange={(e) => set('areaUnitName', e.target.value)}
          error={errors.areaUnit}
        />
      )}

      <SelectField
        label="Union / Ward type"
        id="wardUnitType"
        required
        value={value.wardUnitType}
        onChange={(e) => set('wardUnitType', e.target.value)}
        error={errors.wardUnitType}
      >
        <option value="WARD">Ward (urban)</option>
        <option value="UNION">Union (rural)</option>
      </SelectField>

      <FormField
        label="Union / Ward"
        id="wardUnitName"
        required
        value={value.wardUnitName}
        onChange={(e) => set('wardUnitName', e.target.value)}
        error={errors.wardUnit}
      />

      <FormField
        label="Detailed Address"
        id="detailedAddress"
        required
        value={value.detailedAddress}
        onChange={(e) => set('detailedAddress', e.target.value)}
        error={errors.detailedAddress}
      />

      <FormField
        label="Postal Code (optional)"
        id="postalCode"
        value={value.postalCode}
        onChange={(e) => set('postalCode', e.target.value)}
        error={errors.postalCode}
      />
    </div>
  );
}
