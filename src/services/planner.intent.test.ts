import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannerService } from './planner.service';
import { weatherService } from './weather.service';

/**
 * The prompts that are questions rather than planning requests.
 *
 * The itinerary path is covered in `planner.service.test.ts`; this covers what
 * the planner does *instead* of generating one — which used to be nothing, so
 * "what is the weather in Abu Dhabi?" came back as a five-day Abu Dhabi trip.
 */

const REPORT = {
  place: 'Abu Dhabi',
  country: 'United Arab Emirates',
  countryCode: 'AE',
  temperature: 34,
  description: 'clear',
  high: 38,
  low: 29,
};

const FACTS = {
  name: 'Yerevan',
  country: 'Armenia',
  countryCode: 'AM',
  region: 'Yerevan',
  latitude: 40.18,
  longitude: 44.51,
  timezone: 'Asia/Yerevan',
};

beforeEach(() => {
  weatherService.clearCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('weather questions', () => {
  it('answers instead of inventing a trip', async () => {
    vi.spyOn(weatherService, 'getWeather').mockResolvedValue(REPORT);

    const result = await plannerService.generateItinerary('what is the weather in Abu Dhabi?');

    expect(result.trip).toBeUndefined();
    expect(result.reply).toContain('34°C');
    expect(result.reply).toContain('clear');
    expect(result.reply).toContain('Abu Dhabi, United Arab Emirates');
    expect(result.reply).toContain('high of 38°C');
  });

  it('looks up the place that was asked about', async () => {
    const getWeather = vi.spyOn(weatherService, 'getWeather').mockResolvedValue(REPORT);

    await plannerService.generateItinerary('how hot is it in Cairo right now?');

    expect(getWeather).toHaveBeenCalledWith('Cairo');
  });

  it('asks which place when none was named', async () => {
    const getWeather = vi.spyOn(weatherService, 'getWeather');

    const result = await plannerService.generateItinerary('what is the weather?');

    expect(result.reply).toContain('Which place did you mean?');
    expect(getWeather).not.toHaveBeenCalled();
  });

  it('says so when the place does not exist', async () => {
    vi.spyOn(weatherService, 'getWeather').mockRejectedValue(
      new (await import('./weather.service')).PlaceNotFoundError('Atlantis'),
    );

    const result = await plannerService.generateItinerary('what is the weather in Atlantis?');

    expect(result.reply).toContain('could not find a place called');
    expect(result.trip).toBeUndefined();
  });

  it('says so when the provider is unreachable, rather than guessing', async () => {
    vi.spyOn(weatherService, 'getWeather').mockRejectedValue(new Error('offline'));

    const result = await plannerService.generateItinerary('what is the weather in Cairo?');

    expect(result.reply).toContain('could not reach the weather service');
    expect(result.trip).toBeUndefined();
  });
});

describe('location questions', () => {
  it('answers where a place is', async () => {
    vi.spyOn(weatherService, 'findPlace').mockResolvedValue(FACTS);

    const result = await plannerService.generateItinerary('where is Yerevan?');

    expect(result.trip).toBeUndefined();
    expect(result.reply).toContain('Yerevan, Armenia');
    expect(result.reply).toContain('40.18°N, 44.51°E');
    expect(result.reply).toContain('Asia/Yerevan');
  });

  it('says so when the place does not exist', async () => {
    vi.spyOn(weatherService, 'findPlace').mockRejectedValue(
      new (await import('./weather.service')).PlaceNotFoundError('Atlantis'),
    );

    const result = await plannerService.generateItinerary('where is Atlantis?');

    expect(result.reply).toContain('could not find a place called');
  });

  it('says so when the provider is unreachable', async () => {
    vi.spyOn(weatherService, 'findPlace').mockRejectedValue(new Error('offline'));

    const result = await plannerService.generateItinerary('where is Yerevan?');

    expect(result.reply).toContain('could not reach');
    expect(result.trip).toBeUndefined();
  });

  it('asks which place when none was named', async () => {
    const findPlace = vi.spyOn(weatherService, 'findPlace');

    const result = await plannerService.generateItinerary('where is it?');

    expect(result.reply).toContain('Which place did you mean?');
    expect(findPlace).not.toHaveBeenCalled();
  });

  it('reads southern and western coordinates the right way round', async () => {
    vi.spyOn(weatherService, 'findPlace').mockResolvedValue({
      ...FACTS,
      name: 'Lima',
      country: 'Peru',
      region: 'Lima',
      latitude: -12.05,
      longitude: -77.04,
      timezone: undefined,
    });

    const result = await plannerService.generateItinerary('where is Lima?');

    expect(result.reply).toContain('12.05°S, 77.04°W');
  });
});

describe('questions it cannot answer', () => {
  it('declines plainly rather than building something', async () => {
    const result = await plannerService.generateItinerary('is the tap water safe in Hanoi?');

    expect(result.trip).toBeUndefined();
    expect(result.reply).toContain("I can't answer that one yet");
  });
});

describe('planning requests', () => {
  it('still generates, and never calls the weather provider', async () => {
    const getWeather = vi.spyOn(weatherService, 'getWeather');

    const result = await plannerService.generateItinerary('Plan a 7-day trip to Bali');

    expect(result.trip?.title).toBe('Bali Adventure');
    expect(getWeather).not.toHaveBeenCalled();
  });

  it('treats a question about what to do as a trip request', async () => {
    const result = await plannerService.generateItinerary('what should I do in Rome?');

    expect(result.trip).toBeDefined();
  });
});
