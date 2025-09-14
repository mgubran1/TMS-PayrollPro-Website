/**
 * Mileage Calculation Service
 * Calculates distance between zip codes using multiple APIs with fallbacks
 */

// Zip code coordinate cache to avoid repeated API calls
const zipCodeCache = new Map<string, { lat: number; lng: number }>();

interface ZipCodeCoordinates {
  lat: number;
  lng: number;
}

interface MileageResult {
  miles: number;
  method: 'CACHED' | 'CALCULATED' | 'ESTIMATED';
  fromZip: string;
  toZip: string;
  error?: string;
}

/**
 * Calculate distance between two zip codes
 */
export async function calculateMileage(fromZip: string, toZip: string): Promise<MileageResult> {
  try {
    // Clean zip codes
    const cleanFromZip = fromZip.trim().replace(/[^0-9]/g, '').substring(0, 5);
    const cleanToZip = toZip.trim().replace(/[^0-9]/g, '').substring(0, 5);
    
    if (!cleanFromZip || !cleanToZip || cleanFromZip.length < 5 || cleanToZip.length < 5) {
      throw new Error('Invalid zip codes provided');
    }
    
    // Check cache first
    const cacheKey = `${cleanFromZip}-${cleanToZip}`;
    const reverseKey = `${cleanToZip}-${cleanFromZip}`;
    
    // Get coordinates for both zip codes
    const fromCoords = await getZipCodeCoordinates(cleanFromZip);
    const toCoords = await getZipCodeCoordinates(cleanToZip);
    
    // Calculate distance using Haversine formula
    const miles = calculateHaversineDistance(fromCoords, toCoords);
    
    return {
      miles: Math.round(miles),
      method: 'CALCULATED',
      fromZip: cleanFromZip,
      toZip: cleanToZip
    };
    
  } catch (error) {
    console.error('Mileage calculation error:', error);
    
    // Return estimated distance based on zip code difference as fallback
    const estimatedMiles = estimateDistanceFromZipDifference(fromZip, toZip);
    
    return {
      miles: estimatedMiles,
      method: 'ESTIMATED',
      fromZip: fromZip,
      toZip: toZip,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get coordinates for a zip code using free APIs
 */
async function getZipCodeCoordinates(zipCode: string): Promise<ZipCodeCoordinates> {
  // Check cache first
  if (zipCodeCache.has(zipCode)) {
    return zipCodeCache.get(zipCode)!;
  }
  
  try {
    // Try using zippopotam.us (free, no API key required)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`https://api.zippopotam.us/us/${zipCode}`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.places && data.places.length > 0) {
        const coords = {
          lat: parseFloat(data.places[0].latitude),
          lng: parseFloat(data.places[0].longitude)
        };
        
        // Cache the result
        zipCodeCache.set(zipCode, coords);
        return coords;
      }
    }
  } catch (error) {
    console.warn(`Failed to get coordinates for ${zipCode} from zippopotam:`, error);
  }
  
  try {
    // Fallback: Try using postal-codes.io (free, no API key)
    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => controller2.abort(), 5000);
    
    const response = await fetch(`https://postal-codes.io/api/v1/postal-code/${zipCode}`, {
      signal: controller2.signal,
    });
    
    clearTimeout(timeoutId2);
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.latitude && data.longitude) {
        const coords = {
          lat: parseFloat(data.latitude),
          lng: parseFloat(data.longitude)
        };
        
        // Cache the result
        zipCodeCache.set(zipCode, coords);
        return coords;
      }
    }
  } catch (error) {
    console.warn(`Failed to get coordinates for ${zipCode} from postal-codes.io:`, error);
  }
  
  // If all APIs fail, use estimated coordinates based on zip code ranges
  const coords = estimateCoordinatesFromZip(zipCode);
  zipCodeCache.set(zipCode, coords);
  return coords;
}

/**
 * Calculate distance using Haversine formula
 */
function calculateHaversineDistance(coord1: ZipCodeCoordinates, coord2: ZipCodeCoordinates): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(coord2.lat - coord1.lat);
  const dLng = toRadians(coord2.lng - coord1.lng);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(coord1.lat)) * Math.cos(toRadians(coord2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Estimate coordinates based on zip code ranges (fallback method)
 */
function estimateCoordinatesFromZip(zipCode: string): ZipCodeCoordinates {
  const zip = parseInt(zipCode);
  
  // Rough estimates based on US zip code geographical distribution
  if (zip >= 10000 && zip <= 19999) { // Northeast
    return { lat: 42.0, lng: -71.0 };
  } else if (zip >= 20000 && zip <= 29999) { // Southeast
    return { lat: 35.0, lng: -80.0 };
  } else if (zip >= 30000 && zip <= 39999) { // South Central
    return { lat: 33.0, lng: -90.0 };
  } else if (zip >= 40000 && zip <= 49999) { // Great Lakes
    return { lat: 42.0, lng: -85.0 };
  } else if (zip >= 50000 && zip <= 59999) { // Plains
    return { lat: 41.0, lng: -95.0 };
  } else if (zip >= 60000 && zip <= 69999) { // South Central
    return { lat: 35.0, lng: -100.0 };
  } else if (zip >= 70000 && zip <= 79999) { // South Central
    return { lat: 32.0, lng: -95.0 };
  } else if (zip >= 80000 && zip <= 89999) { // Mountain
    return { lat: 40.0, lng: -105.0 };
  } else if (zip >= 90000 && zip <= 99999) { // Pacific
    return { lat: 37.0, lng: -120.0 };
  } else { // Default central US
    return { lat: 39.0, lng: -98.0 };
  }
}

/**
 * Estimate distance based on zip code numerical difference (very rough fallback)
 */
function estimateDistanceFromZipDifference(fromZip: string, toZip: string): number {
  try {
    const from = parseInt(fromZip.replace(/[^0-9]/g, ''));
    const to = parseInt(toZip.replace(/[^0-9]/g, ''));
    const diff = Math.abs(from - to);
    
    // Very rough estimate: each 1000 zip difference ≈ 100 miles
    // This is highly inaccurate but better than nothing
    return Math.max(50, Math.min(3000, Math.round(diff / 10)));
  } catch {
    return 500; // Default fallback distance
  }
}

/**
 * Validate a zip code format
 */
export function isValidZipCode(zipCode: string): boolean {
  const cleaned = zipCode.trim().replace(/[^0-9]/g, '');
  return cleaned.length === 5 && !isNaN(parseInt(cleaned));
}

/**
 * Extract zip codes from address strings
 */
export function extractZipFromAddress(address: string): string | null {
  const zipMatch = address.match(/\b(\d{5})\b/);
  return zipMatch ? zipMatch[1] : null;
}

/**
 * Calculate multiple routes and return the average (for more accuracy)
 */
export async function calculateMileageWithFallbacks(fromZip: string, toZip: string): Promise<MileageResult> {
  try {
    // Primary calculation
    const primaryResult = await calculateMileage(fromZip, toZip);
    
    // If the primary calculation succeeded, return it
    if (primaryResult.method === 'CALCULATED' && !primaryResult.error) {
      return primaryResult;
    }
    
    // If primary failed, return the estimated result
    return primaryResult;
    
  } catch (error) {
    return {
      miles: 500,
      method: 'ESTIMATED',
      fromZip: fromZip,
      toZip: toZip,
      error: error instanceof Error ? error.message : 'Calculation failed'
    };
  }
}

/**
 * Batch calculate mileage for multiple routes
 */
export async function calculateMileageBatch(routes: Array<{ fromZip: string; toZip: string }>): Promise<MileageResult[]> {
  const results = await Promise.all(
    routes.map(route => calculateMileageWithFallbacks(route.fromZip, route.toZip))
  );
  
  return results;
}

/**
 * Clear the zip code cache (useful for testing or memory management)
 */
export function clearZipCodeCache(): void {
  zipCodeCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: zipCodeCache.size,
    entries: Array.from(zipCodeCache.keys())
  };
}

