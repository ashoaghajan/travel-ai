import { useCallback, useEffect, useRef, useState } from 'react';
import { currentCityAirportService } from '../services/currentCityAirport.service';

/** Apply a location default once, without replacing a route the reader is editing. */
export function useFlightOrigin(
  initialFrom: string,
  useCurrentLocation: boolean,
  onDefaulted?: (code: string) => void,
) {
  const [from, setFrom] = useState(initialFrom);
  const touched = useRef(false);
  const keepOrigin = useCallback(() => { touched.current = true; }, []);
  const changeFrom = useCallback((code: string) => {
    touched.current = true;
    setFrom(code);
  }, []);

  useEffect(() => {
    if (!useCurrentLocation || touched.current) return;
    const controller = new AbortController();

    void currentCityAirportService.locate(controller.signal).then((airport) => {
      if (!airport || controller.signal.aborted || touched.current) return;
      setFrom(airport.code);
      onDefaulted?.(airport.code);
    });

    return () => controller.abort();
  }, [useCurrentLocation, onDefaulted]);

  return { from, changeFrom, keepOrigin };
}
