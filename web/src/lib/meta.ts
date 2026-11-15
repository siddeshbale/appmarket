import { createContext, useContext } from 'react';

export const MetaCtx = createContext<any>(null);
export const useMeta = () => useContext(MetaCtx);
