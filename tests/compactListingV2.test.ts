import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LISTING_GENERATOR_SYSTEM_PROMPT,
  LEGACY_LISTING_GENERATOR_SYSTEM_PROMPT_V1
} from '../src/server/services/systemPromptService';
import { ListingValidationService } from '../src/server/services/listingValidationService';

test('title tail prefers subniche, otherwise niche1, and never implicitly uses niche2', () => {
  assert.equal(ListingValidationService.resolveExpectedTitleSuffix({
    niche1: 'Horse',
    niche2: 'Dressage',
    subniche: 'Friesian Horse'
  }), 'Friesian Horse');

  assert.equal(ListingValidationService.resolveExpectedTitleSuffix({
    niche1: 'Horse',
    niche2: 'Dressage'
  }), 'Horse');
});

test('compact, non-padded listing passes max-only validation', () => {
  const result = ListingValidationService.validateAndRepairListing({
    listing: {
      brand: 'Friesian Riders',
      title: 'Majestic Black Stallion Friesian Horse',
      bullet1: 'For Friesian riders who know the breed’s proud carriage and flowing mane.',
      bullet2: 'Fits stable days, dressage practice, breed shows, and equestrian meetups.',
      description: 'A bold Friesian horse design centered on the breed’s unmistakable silhouette.'
    },
    niche1: 'Horse',
    niche2: 'Dressage',
    subniche: 'Friesian Horse'
  });

  assert.equal(result.isValid, true, result.issues.join(' | '));
  assert.equal(result.listing.title.endsWith('Friesian Horse'), true);
  assert.equal(result.listing.brand.length < 40, true);
  assert.equal(result.listing.bullet1.length < 230, true);
});

test('wrong niche2 tail is repaired to the locked niche1 tail', () => {
  const result = ListingValidationService.validateAndRepairListing({
    listing: {
      brand: 'Equestrian Humor',
      title: 'Arena Life Dressage',
      bullet1: 'For riders who understand arena life.',
      bullet2: 'For training days and stable time.',
      description: 'A concise equestrian design.'
    },
    niche1: 'Horse',
    niche2: 'Dressage'
  });

  assert.equal(result.listing.title.endsWith('Horse'), true);
  assert.equal(result.listing.title.endsWith('Dressage'), false);
});

test('compact prompt forbids padding while legacy rollback source remains available', () => {
  assert.match(DEFAULT_LISTING_GENERATOR_SYSTEM_PROMPT, /LISTING_CONTRACT: compact-v2/);
  assert.match(DEFAULT_LISTING_GENERATOR_SYSTEM_PROMPT, /Never pad a field/);
  assert.match(DEFAULT_LISTING_GENERATOR_SYSTEM_PROMPT, /TITLE_TAIL/);
  assert.match(LEGACY_LISTING_GENERATOR_SYSTEM_PROMPT_V1, /40-50 characters/);
});
