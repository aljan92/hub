# 📄 Amazon Merch on Demand — Product Configuration API Spezifikation

Dieses Dokument beschreibt die vollständige Struktur, Datenfelder und Schemata des Amazon Merch on Demand Endpunkts:
`GET https://merch.amazon.com/api/productconfiguration/get?id={designId}`

---

## 1. 🌐 Endpunkt-Übersicht

* **URL:** `https://merch.amazon.com/api/productconfiguration/get?id={designId}`
* **Methode:** `GET`
* **Authentifizierung:** Amazon Session-Cookies (Credentials `include` im Browser-Kontext von Session 1)
* **Parameter:** `id` = UUID des Designs (z. B. `495f452e-8245-42be-96e3-a1d3dcc752d9`)
* **Antwortformat:** `application/json`

---

## 2. 🏛️ Root-Objekt Struktur

```typescript
export interface AmazonProductConfigResponse {
  globalArtworkUrn: string;              // z. B. "urn:cas:914b3023-8a58-4659-b3f4-677683017c01/ARTWORK_IMAGE"
  translationRequested: boolean;          // true / false
  collabDesignId: string | null;
  brandId: string | null;
  programId: string | null;
  embargoDate: string | null;
  isModify: boolean;                     // false bei Original, true bei Entwurf
  discoverable: boolean;
  textData: Record<string, AmazonTextDataLanguage>; // 'en', 'de', 'fr', 'it', 'es', 'ja'
  products: Record<string, AmazonProductConfiguration>; // Key = ProductType (z. B. 'STANDARD_TSHIRT')
}
```

---

## 3. 📝 Text & Listing Daten (`textData`)

Amazon liefert für jede gepflegte Sprache (`en`, `de`, `fr`, `it`, `es`, `ja`) ein separates Textobjekt:

```typescript
export interface AmazonTextDataLanguage {
  brandName: string;                     // Markenname (z. B. "Angel Number 222 Celestial Spiritual Seekers")
  title: string;                         // Produkttitel (z. B. "222 Angel Number Celestial Wings Spiritual Guidance Sign")
  bullets: string[];                     // Bullet 1 & Bullet 2 als Array (Index 0 und 1)
  description: string;                   // Vollständige Produktbeschreibung
  autoTranslated: boolean;               // true, wenn von Amazon automatisch übersetzt; false bei Original
}
```

### 💡 Relevanz für das Update-Feature:
* `textData.en` liefert das Master-Listing.
* `autoTranslated: true` zeigt, ob ein Marktplatz manuell oder durch Amazons Auto-Translator befüllt wurde.
* Für das Rewrite-Listing können Originaltexte (`brandName`, `title`, `bullets`, `description`) direkt als Kontext an den OpenRouter LLM-Prompt übergeben werden.

---

## 4. 👕 Produkt- & Marktplatz-Konfiguration (`products`)

Jedes Produkt (z. B. `STANDARD_TSHIRT`, `PREMIUM_TSHIRT`, `PHONE_CASE_APPLE_IPHONE`, `MUG`, etc.) enthält Dimensionen, Asset-Instruktionen und Marktplatz-Daten:

```typescript
export interface AmazonProductConfiguration {
  dimensions: {
    FIT: string[];                       // z. B. ["men", "women"], ["unisex"], ["none"]
    COLOR: string[];                     // z. B. ["black", "white", "navy", "heather_grey", "pepper", "blue_jean"]
  };
  assets: {
    FRONT?: string;                      // URN des gerenderten Front-Assets
    BACK?: string;                       // URN des gerenderten Back-Assets (z. B. Phone Cases)
    POP_SOCKET?: string;                 // URN des PopSocket-Assets
  };
  artworkInstructions: {
    FRONT?: ArtworkInstruction;
    BACK?: ArtworkInstruction;
    POP_SOCKET?: ArtworkInstruction;
  };
  marketplaceData: Record<string, AmazonMarketplaceData>; // 'US', 'DE', 'GB', 'FR', 'IT', 'ES', 'JP'
}

export interface ArtworkInstruction {
  urn: string;                           // Master Artwork URN
  canvasWidth: number;                   // Ziel-Breite des Print-Canvas (z. B. 4500, 1800, 2925, 2700, 1500, 485)
  canvasHeight: number;                  // Ziel-Höhe des Print-Canvas (z. B. 5400, 4050, 3200, 2925, 1050, 675, 485)
  scale: number;                         // Skalierungsfaktor (z. B. 1, 0.75, 0.449, 0.244, 0.125, 0.06)
  topOffset: number;                     // Pixel-Offset Y
  leftOffset: number;                    // Pixel-Offset X
  backgroundColor: string | null;        // Hex-Farbe (z. B. "#000000" bei Cases/Pillows) oder null bei transparent
}

export interface AmazonMarketplaceData {
  currency: string;                      // "USD", "EUR", "GBP", "JPY"
  price: number;                         // z. B. 19.99
  status: AmazonListingStatus;           // "PUBLISHED", "TRANSLATING", "PROCESSING", "REVIEW", "REJECTED", etc.
  asin: string;                          // B0-ASIN (z. B. "B0HG7N215S")
  id: string;                            // Format: "{designId}_{productType}_{marketplace}"
  deleteReasonType: string | null;
  lockReasonType: string | null;
  modifyTemplateId: string | null;
}

export type AmazonListingStatus = 
  | 'PUBLISHED'
  | 'PROPAGATED'
  | 'PUBLISHING'
  | 'PROCESSING'
  | 'TRANSLATING'
  | 'REVIEW'
  | 'DRAFT'
  | 'DECLINED'
  | 'AMAZON_REJECTED'
  | 'DELETED'
  | 'LOCKED'
  | 'TIMED_OUT';
```

---

## 5. 📐 Canvas- & Dimensionen-Referenztabelle

Die Analyse der echten API-Antwort liefert die exakten Canvas-Maße und Skalierungen von Amazon Merch:

| Produkt-Typ | Print-Fläche (Canvas) | Scale | Typischer Fit | Hintergrund |
| :--- | :--- | :--- | :--- | :--- |
| `STANDARD_TSHIRT`, `PREMIUM_TSHIRT`, `VNECK`, `TANK_TOP`, `RAGLAN`, `OVERSIZED_TSHIRT`, `PERFORMANCE_TSHIRT`, `VALUE_TSHIRT`, `BASEBALL_JERSEY`, `SOCCER_JERSEY`, `BASKETBALL_JERSEY`, `STANDARD_LONG_SLEEVE`, `STANDARD_SWEATSHIRT`, `COMFORT_COLORS_SWEATSHIRT` | **4500 × 5400 px** | `1.0` | `men`, `women`, `unisex` | `null` (Transparent) |
| `STANDARD_PULLOVER_HOODIE`, `ZIP_HOODIE`, `PERFORMANCE_HOODIE`, `CROP_TOP`, `COMFORT_COLORS_CROP_SWEATSHIRT` | **4500 × 4050 px** | `0.75` | `unisex`, `women` | `null` (Transparent) |
| `PHONE_CASE_APPLE_IPHONE`, `PHONE_CASE_SAMSUNG_GALAXY` | **1800 × 3200 px** | `0.244` | `none` | `#000000` / Hex |
| `THROW_PILLOW`, `TOTE_BAG` | **2925 × 2925 px** | `0.425` – `0.449` | `none` | `#000000` / Hex |
| `MUG` | **2700 × 1050 px** | `0.194` | `none` | `null` / Hex |
| `PRINTED_BASEBALL_HAT`, `PRINTED_TRUCKER_HAT`, `SPORT_SUN_VISOR` | **1500 × 675 px** | `0.125` | `none`, `unisex` | `null` |
| `HARDCOVER_JOURNAL` | **1050 × 1950 px** | `0.233` | `none` | `null` |
| `TUMBLER`, `WATER_BOTTLE` | **3000 × 1400 px** | `0.259` | `none` | `null` |
| `POP_SOCKET` | **485 × 485 px** | `0.06` | `none` | `#000000` / Hex |

---

## 6. 🎯 Logik-Anwendungen für das MBA HUB Update-Feature

### 1. Status-Filter & Sicherheitsprüfung:
* Durchlaufe alle Einträge in `products[productKey].marketplaceData[marketplaceKey].status`.
* **Bereit zum Update:** Wenn alle existierenden Produkte `status === "PUBLISHED"` haben.
* **Überspringen / Ignorieren:** Wenn mindestens ein Produkt `TRANSLATING`, `PROCESSING`, `REVIEW` oder `AMAZON_REJECTED` aufweist.

### 2. Slot-Berechnung (0-Slot Ersparnis):
* Wenn ein Produkt auf einem Marktplatz bereits existiert und `status === "PUBLISHED"` ist ➔ **0 Slots** täglicher Verbrauch.
* Wenn bei der Aktualisierung ein neues Produkt oder ein neuer Marktplatz aktiviert wird, der vorher in `marketplaceData` fehlte ➔ **+1 Slot** Verbrauch.

### 3. Extraktion bestehender Einstellungen:
* **Fit-Types:** Aus `dimensions.FIT` auslesen (z. B. `["men", "women"]`).
* **Farben:** Aus `dimensions.COLOR` auslesen.
* **Master-Listing:** Aus `textData.en` auslesen.
