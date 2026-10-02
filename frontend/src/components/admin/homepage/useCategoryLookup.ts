'use client';

import { useEffect, useState } from 'react';
import { apiList } from '@/lib/apiClient';
import type { CmsCategoryLookup } from '@/lib/admin/types';

/** Loads the CMS category lookup (all categories, `cms.manage` only) for pickers. */
export function useCategoryLookup(): { categories: CmsCategoryLookup[]; failed: boolean } {
  const [categories, setCategories] = useState<CmsCategoryLookup[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiList<CmsCategoryLookup>('/api/admin/cms/lookups/categories?pageSize=100')
      .then(({ data }) => setCategories(data))
      .catch(() => setFailed(true));
  }, []);

  return { categories, failed };
}
