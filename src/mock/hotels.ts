import type { Hotel } from '../types/travel.types';
import komanekaImage from '../assets/hotels/komaneka.jpg';
import alayaImage from '../assets/hotels/alaya.jpg';
import ubudVillageImage from '../assets/hotels/ubud-village.jpg';
import elementImage from '../assets/hotels/element.jpg';

/**
 * Mock hotel results — DESIGN_SPEC Screen 5, in the order the "Recommended"
 * sort shows them.
 *
 * `bookingUrl` is null throughout, for the reason given in `mock/flights.ts`:
 * an invented nightly rate must not carry a link to a real checkout.
 */
export const MOCK_HOTELS: Hotel[] = [
  {
    id: 'hotel-komaneka-bisma',
    name: 'Komaneka at Bisma',
    location: 'Ubud',
    category: 'Luxury Resort',
    rating: 4.8,
    reviews: 345,
    pricePerNight: 320,
    image: komanekaImage,
    bookingUrl: null,
  },
  {
    id: 'hotel-alaya-ubud',
    name: 'Alaya Resort Ubud',
    location: 'Ubud',
    category: '5★ Resort',
    rating: 4.6,
    reviews: 312,
    pricePerNight: 195,
    image: alayaImage,
    bookingUrl: null,
  },
  {
    id: 'hotel-ubud-village',
    name: 'The Ubud Village Resort',
    location: 'Ubud',
    category: 'Resort',
    rating: 4.5,
    reviews: 298,
    pricePerNight: 160,
    image: ubudVillageImage,
    bookingUrl: null,
  },
  {
    id: 'hotel-element-westin',
    name: 'Element by Westin Bali Ubud',
    location: 'Ubud',
    category: 'Resort',
    rating: 4.4,
    reviews: 210,
    pricePerNight: 138,
    image: elementImage,
    bookingUrl: null,
  },
];

/** Destination the mock results belong to (DESIGN_SPEC Screen 5 header). */
export const HOTEL_DESTINATION = 'Ubud';
