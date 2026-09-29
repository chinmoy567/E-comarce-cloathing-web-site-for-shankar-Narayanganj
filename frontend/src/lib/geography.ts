import { apiGet } from './apiClient';

/** Bangladesh administrative geography lookups (task §6), mirrored from `backend/src/types/geography.ts`. */
export type GeoNode = {
  id: string;
  pcode: string;
  name: string;
};

export function fetchDivisions(): Promise<GeoNode[]> {
  return apiGet<GeoNode[]>('/api/geography/divisions');
}

export function fetchDistricts(divisionId: string): Promise<GeoNode[]> {
  return apiGet<GeoNode[]>(`/api/geography/divisions/${encodeURIComponent(divisionId)}/districts`);
}

export function fetchUpazilas(districtId: string): Promise<GeoNode[]> {
  return apiGet<GeoNode[]>(`/api/geography/districts/${encodeURIComponent(districtId)}/upazilas`);
}
