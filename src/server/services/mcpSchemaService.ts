/**
 * MBA HUB Tool Schema Definitions for Hermes Agent & MCP Clients
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MBA_HUB_TOOLS: ToolDefinition[] = [
  {
    name: 'mba_hub_check_trademark',
    description: 'Performs live Merch by Amazon (MBA) trademark checks across USPTO, EUIPO, and DPMA databases. Analyzes Nice Class 25 (Clothing/Apparel) and secondary classes (Class 9 PopSockets/Cases, Class 21 Mugs, Class 20 Pillows, Class 18 Bags). Checks full phrases, n-grams, and keywords.',
    parameters: {
      type: 'object',
      properties: {
        offices: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['USPTO', 'EUIPO', 'DPMA']
          },
          description: 'Trademark offices to query. Default is ["USPTO"]. Options: USPTO (US), EUIPO (European Union / UK / Europe), DPMA (Germany).'
        },
        marketplace: {
          type: 'string',
          description: 'Alternative shorthand for marketplace: "US" (USPTO), "DE" (DPMA + EUIPO), "EU" (EUIPO), "UK" (EUIPO). Used if offices is not specified.'
        },
        fields: {
          type: 'object',
          description: 'Listing text fields to check for trademark violations. Must contain at least one field.',
          properties: {
            phrase: {
              type: 'string',
              description: 'Main design quote / slogan / text appearing on the shirt (e.g. "Powered by Coffee")'
            },
            title: {
              type: 'string',
              description: 'Amazon product title (e.g. "Retro Vintage Coffee Lover T-Shirt")'
            },
            brand: {
              type: 'string',
              description: 'Brand name (e.g. "Vintage Cafe Apparel")'
            },
            bullet1: {
              type: 'string',
              description: 'Feature bullet point 1'
            },
            bullet2: {
              type: 'string',
              description: 'Feature bullet point 2'
            },
            description: {
              type: 'string',
              description: 'Product description'
            }
          }
        }
      },
      required: ['fields']
    }
  },
  {
    name: 'mba_hub_submit_task',
    description: 'Submits a new design task (prompt, quote, metadata) to the MBA HUB queue for review or automatic generation.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Image generation prompt for Ideogram / Midjourney'
        },
        quote: {
          type: 'string',
          description: 'Text quote on the design'
        },
        niche1: {
          type: 'string',
          description: 'Main niche category (e.g. "Retro Cats")'
        },
        niche2: {
          type: 'string',
          description: 'Sub-niche or style (e.g. "80s Synthwave")'
        },
        title: {
          type: 'string',
          description: 'Listing title'
        },
        brand: {
          type: 'string',
          description: 'Listing brand'
        },
        bullet1: {
          type: 'string',
          description: 'Feature bullet point 1'
        },
        bullet2: {
          type: 'string',
          description: 'Feature bullet point 2'
        },
        description: {
          type: 'string',
          description: 'Listing description'
        }
      },
      required: ['prompt']
    }
  }
];

export function getMcpSchema() {
  return {
    version: '1.0.0',
    server: 'MBA_HUB',
    description: 'Merch by Amazon Command Center MCP & REST Integration',
    tools: MBA_HUB_TOOLS,
    endpoints: {
      health: {
        method: 'GET',
        path: '/api/v1/mcp/health',
        auth: 'Optional: x-mba-api-key (validates connectivity and auth status)'
      },
      check_trademark: {
        method: 'POST',
        path: '/api/v1/mcp/trademark/check',
        auth: 'Header: x-mba-api-key OR Authorization: Bearer <key>'
      },
      submit_task: {
        method: 'POST',
        path: '/api/v1/hermes/task',
        auth: 'Header: x-mba-api-key OR Authorization: Bearer <key>'
      }
    }
  };
}
