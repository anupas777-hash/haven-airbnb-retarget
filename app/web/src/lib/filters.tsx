import React, { createContext, useContext, useState } from 'react';

export type GlobalFilters = {
  city: string; // '' = All
  propertyId: string; // '' = All
  from: string; // YYYY-MM-DD
  to: string;
};

const defaultFilters: GlobalFilters = {
  city: '',
  propertyId: '',
  from: '',
  to: '',
};

const FilterContext = createContext<{
  filters: GlobalFilters;
  setFilters: React.Dispatch<React.SetStateAction<GlobalFilters>>;
}>({
  filters: defaultFilters,
  setFilters: () => {},
});

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(() => {
    const saved = localStorage.getItem('haven_global_filters');
    if (saved) {
      try { return { ...defaultFilters, ...JSON.parse(saved) }; } catch {}
    }
    return defaultFilters;
  });

  React.useEffect(() => {
    localStorage.setItem('haven_global_filters', JSON.stringify(filters));
  }, [filters]);

  return <FilterContext.Provider value={{ filters, setFilters }}>{children}</FilterContext.Provider>;
}

export function useGlobalFilters() {
  return useContext(FilterContext);
}

export function toApiParams(filters: GlobalFilters): Record<string, any> {
  const p: Record<string, any> = {};
  if (filters.city) p.city = filters.city;
  if (filters.propertyId) p.propertyId = filters.propertyId;
  if (filters.from) p.from = filters.from;
  if (filters.to) p.to = filters.to;
  return p;
}
