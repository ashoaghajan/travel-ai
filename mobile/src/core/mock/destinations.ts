import type { ActivityCategory } from '../types/trip.types';
/*
 * DIFFERS FROM WEB: ids instead of imported images.
 *
 * The web imports eight `.jpg` files here and embeds whichever URL Vite
 * resolved them to straight into the templates. Metro resolves an image import
 * to an opaque module number, and these values end up inside a `TripDraft`
 * that is stored and sent to the API — so a number here is corrupt data rather
 * than a broken thumbnail.
 *
 * The ids are the same ones `bundled-images.ts` knows on both sides, so a trip
 * built from these templates on a phone shows the right photographs in a
 * browser too. Drawing goes through `imageSource`.
 */
const dayOneUbud = 'itinerary/day-1-ubud';
const dayTwoUbud = 'itinerary/day-2-ubud';
const dayThreeNusaPenida = 'itinerary/day-3-nusa-penida';
const dayFourUluwatu = 'itinerary/day-4-uluwatu';
const coastImage = 'generic/coast';
const cityImage = 'generic/city';
const natureImage = 'generic/nature';
const foodImage = 'generic/food';

/**
 * Templates the mock AI builds itineraries from.
 *
 * Stage 2 replaces all of this with a real model response, so nothing here is
 * imported outside `mockAi.service.ts` and the seeded conversation.
 */

export type ActivityTemplate = {
  time: string;
  title: string;
  description: string;
  category: ActivityCategory;
  priceEstimate?: number;
};

export type DayTemplate = {
  /** Empty means "use the trip's destination name". */
  destination: string;
  summary: string;
  image: string;
  activities: ActivityTemplate[];
};

export type DestinationTemplate = {
  id: string;
  /** Display name used for the destination field. */
  name: string;
  /** Trip title when this template is picked. */
  tripTitle: string;
  coverImage: string;
  /** Lower-case terms matched against the prompt. */
  keywords: string[];
  /** Cycled through for every day except the last. */
  days: DayTemplate[];
  /** Always used for the final day. */
  departure: DayTemplate;
};

const BALI: DestinationTemplate = {
  id: 'bali',
  name: 'Bali',
  tripTitle: 'Bali Adventure',
  coverImage: dayThreeNusaPenida,
  keywords: ['bali', 'ubud', 'canggu', 'seminyak', 'uluwatu', 'indonesia'],
  days: [
    {
      destination: 'Ubud',
      summary: 'Welcome & relax in Ubud',
      image: dayOneUbud,
      activities: [
        {
          time: '14:00',
          title: 'Check in to your jungle villa',
          description: 'Settle in, unpack and take the afternoon slowly by the pool.',
          category: 'relaxation',
          priceEstimate: 0,
        },
        {
          time: '18:30',
          title: 'Dinner on Jalan Bisma',
          description: 'Balinese classics a short walk from your stay.',
          category: 'food',
          priceEstimate: 25,
        },
      ],
    },
    {
      destination: 'Ubud',
      summary: 'Explore temples & rice terraces',
      image: dayTwoUbud,
      activities: [
        {
          time: '08:00',
          title: 'Tegalalang rice terraces',
          description: 'Walk the terraces early, before the tour buses arrive.',
          category: 'nature',
          priceEstimate: 15,
        },
        {
          time: '11:30',
          title: 'Tirta Empul water temple',
          description: 'Holy spring temple with a purification ritual you can join.',
          category: 'culture',
          priceEstimate: 10,
        },
      ],
    },
    {
      destination: 'Nusa Penida',
      summary: 'Beach day & snorkelling',
      image: dayThreeNusaPenida,
      activities: [
        {
          time: '07:00',
          title: 'Fast boat from Sanur',
          description: 'Forty minutes across to the island, book the early crossing.',
          category: 'travel',
          priceEstimate: 35,
        },
        {
          time: '10:00',
          title: 'Kelingking Beach & snorkel stop',
          description: 'Clifftop viewpoint first, then snorkelling with manta rays.',
          category: 'adventure',
          priceEstimate: 45,
        },
      ],
    },
    {
      destination: 'Uluwatu',
      summary: 'Cliffs, sunset & Kecak dance',
      image: dayFourUluwatu,
      activities: [
        {
          time: '16:00',
          title: 'Uluwatu clifftop walk',
          description: 'Ocean views along the temple path — watch your sunglasses, the monkeys are quick.',
          category: 'nature',
          priceEstimate: 5,
        },
        {
          time: '18:00',
          title: 'Kecak fire dance',
          description: 'Open-air performance timed with the sunset.',
          category: 'culture',
          priceEstimate: 25,
        },
      ],
    },
    {
      destination: 'Seminyak',
      summary: 'Beach day & shopping',
      image: coastImage,
      activities: [
        {
          time: '10:00',
          title: 'Seminyak beach morning',
          description: 'Long swims, sun loungers and breakfast on the sand.',
          category: 'relaxation',
          priceEstimate: 15,
        },
        {
          time: '15:00',
          title: 'Boutiques on Jalan Kayu Aya',
          description: 'Local designers and concept stores along the main strip.',
          category: 'culture',
          priceEstimate: 0,
        },
      ],
    },
    {
      destination: 'Canggu',
      summary: 'Food & surf culture',
      image: foodImage,
      activities: [
        {
          time: '07:30',
          title: 'Beginner surf lesson',
          description: 'Two hours on the soft waves at Batu Bolong.',
          category: 'adventure',
          priceEstimate: 40,
        },
        {
          time: '12:30',
          title: 'Canggu cafe crawl',
          description: 'Brunch spots and specialty coffee between the rice fields.',
          category: 'food',
          priceEstimate: 30,
        },
      ],
    },
  ],
  departure: {
    destination: 'Departure',
    summary: 'Last-minute shopping',
    image: cityImage,
    activities: [
      {
        time: '09:00',
        title: 'Coffee and souvenirs',
        description: 'Textiles, sarongs and beans to take home.',
        category: 'culture',
        priceEstimate: 20,
      },
      {
        time: '13:00',
        title: 'Transfer to Denpasar airport',
        description: 'Leave two hours for traffic heading south.',
        category: 'travel',
        priceEstimate: 20,
      },
    ],
  },
};

/** Used when the prompt names a destination we have no template for. */
export const GENERIC_DESTINATION: DestinationTemplate = {
  id: 'generic',
  name: 'Your destination',
  tripTitle: 'Your Trip',
  coverImage: coastImage,
  keywords: [],
  days: [
    {
      destination: '',
      summary: 'Arrival & first impressions',
      image: cityImage,
      activities: [
        {
          time: '15:00',
          title: 'Check in and unpack',
          description: 'Drop your bags and get your bearings on foot.',
          category: 'relaxation',
          priceEstimate: 0,
        },
        {
          time: '18:00',
          title: 'Dinner in the neighbourhood',
          description: 'Somewhere local and unhurried for the first night.',
          category: 'food',
          priceEstimate: 30,
        },
      ],
    },
    {
      destination: '',
      summary: 'Landmarks & old town',
      image: cityImage,
      activities: [
        {
          time: '09:00',
          title: 'Old town walking tour',
          description: 'The main sights with a guide who knows the shortcuts.',
          category: 'culture',
          priceEstimate: 25,
        },
        {
          time: '13:00',
          title: 'Lunch with a view',
          description: 'A rooftop table above the rooftops.',
          category: 'food',
          priceEstimate: 25,
        },
      ],
    },
    {
      destination: '',
      summary: 'Nature escape',
      image: natureImage,
      activities: [
        {
          time: '08:30',
          title: 'Morning hike',
          description: 'An easy trail out of town, back before the heat.',
          category: 'nature',
          priceEstimate: 15,
        },
        {
          time: '14:00',
          title: 'Picnic by the water',
          description: 'Pick up supplies at the market on the way.',
          category: 'relaxation',
          priceEstimate: 10,
        },
      ],
    },
    {
      destination: '',
      summary: 'Food & markets',
      image: foodImage,
      activities: [
        {
          time: '10:00',
          title: 'Market tour with a local guide',
          description: 'Producers, tastings and the dishes worth queueing for.',
          category: 'food',
          priceEstimate: 35,
        },
        {
          time: '19:30',
          title: 'Street food crawl',
          description: 'Small plates across a few stalls, one street at a time.',
          category: 'food',
          priceEstimate: 25,
        },
      ],
    },
    {
      destination: '',
      summary: 'Coast & slow afternoon',
      image: coastImage,
      activities: [
        {
          time: '10:30',
          title: 'Coastal path walk',
          description: 'Cliffs, coves and a swim stop halfway.',
          category: 'nature',
          priceEstimate: 0,
        },
        {
          time: '15:00',
          title: 'Afternoon by the water',
          description: 'Nothing scheduled — that is the point.',
          category: 'relaxation',
          priceEstimate: 30,
        },
      ],
    },
    {
      destination: '',
      summary: 'Day trip',
      image: natureImage,
      activities: [
        {
          time: '08:00',
          title: 'Day trip to a nearby town',
          description: 'Early train out, wander, late lunch, easy ride back.',
          category: 'adventure',
          priceEstimate: 45,
        },
        {
          time: '17:00',
          title: 'Sunset viewpoint',
          description: 'The spot locals go to, not the one on the postcards.',
          category: 'nature',
          priceEstimate: 0,
        },
      ],
    },
  ],
  departure: {
    destination: 'Departure',
    summary: 'Slow morning & last souvenirs',
    image: cityImage,
    activities: [
      {
        time: '09:30',
        title: 'Souvenir shopping',
        description: 'One last coffee and something to take home.',
        category: 'culture',
        priceEstimate: 20,
      },
      {
        time: '12:30',
        title: 'Transfer to the airport',
        description: 'Leave a buffer for traffic and check-in queues.',
        category: 'travel',
        priceEstimate: 20,
      },
    ],
  },
};

export const DESTINATION_TEMPLATES: DestinationTemplate[] = [BALI];

/** The demo trip README asks for ("Bali Adventure"). */
export const DEMO_DESTINATION = BALI;
