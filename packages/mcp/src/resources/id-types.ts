/**
 * MCP resource: hacienda://reference/id-types
 *
 * Identification types and their validation rules for Costa Rica
 * taxpayer identification in electronic documents.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  IdentificationType,
  IDENTIFICATION_TYPE_NAMES,
  IDENTIFICATION_LENGTHS,
} from "@dojocoding/hacienda-shared";

const ID_TYPES_REFERENCE = {
  identificationTypes: [
    {
      code: IdentificationType.CEDULA_FISICA,
      name: IDENTIFICATION_TYPE_NAMES[IdentificationType.CEDULA_FISICA],
      lengths: IDENTIFICATION_LENGTHS[IdentificationType.CEDULA_FISICA],
      description:
        "Physical person identification card. 9-digit number. " +
        "Used for individual taxpayers (personas fisicas).",
      example: "101230456",
    },
    {
      code: IdentificationType.CEDULA_JURIDICA,
      name: IDENTIFICATION_TYPE_NAMES[IdentificationType.CEDULA_JURIDICA],
      lengths: IDENTIFICATION_LENGTHS[IdentificationType.CEDULA_JURIDICA],
      description:
        "Legal entity identification. 10-digit number. " +
        "Used for companies and organizations (sociedades anonimas, etc.).",
      example: "3101234567",
    },
    {
      code: IdentificationType.DIMEX,
      name: IDENTIFICATION_TYPE_NAMES[IdentificationType.DIMEX],
      lengths: IDENTIFICATION_LENGTHS[IdentificationType.DIMEX],
      description:
        "Foreign resident identification (Documento de Identidad Migratoria para Extranjeros). " +
        "11 or 12 digit number. Used for foreign residents in Costa Rica.",
      example: "12345678901",
    },
    {
      code: IdentificationType.NITE,
      name: IDENTIFICATION_TYPE_NAMES[IdentificationType.NITE],
      lengths: IDENTIFICATION_LENGTHS[IdentificationType.NITE],
      description:
        "Tax identification for foreigners without DIMEX " +
        "(Numero de Identificacion Tributaria Especial). 10-digit number.",
      example: "1234567890",
    },
    {
      code: IdentificationType.EXTRANJERO_NO_DOMICILIADO,
      name: IDENTIFICATION_TYPE_NAMES[IdentificationType.EXTRANJERO_NO_DOMICILIADO],
      lengths: IDENTIFICATION_LENGTHS[IdentificationType.EXTRANJERO_NO_DOMICILIADO] ?? [],
      description:
        "Non-domiciled foreign taxpayer identification. Free-form string up to 20 characters.",
      example: "US123456789",
    },
    {
      code: IdentificationType.NO_CONTRIBUYENTE,
      name: IDENTIFICATION_TYPE_NAMES[IdentificationType.NO_CONTRIBUYENTE],
      lengths: IDENTIFICATION_LENGTHS[IdentificationType.NO_CONTRIBUYENTE] ?? [],
      description: "Non-taxpayer identification. Free-form string up to 20 characters.",
      example: "NC000001",
    },
  ],
  notes: {
    formatting:
      "Domestic types 01, 03, and 04 must contain only digits and match their expected lengths; " +
      "type 02 (Cedula Juridica) accepts 10 alphanumeric characters; types 05 and 06 accept " +
      "free-form strings up to 20 characters. No dashes or spaces.",
    usage:
      "The emisor (issuer) always requires identification. " +
      "The receptor (receiver) identification is required for Factura Electronica " +
      "but optional for Tiquete Electronico.",
  },
};

export function registerIdTypesResource(server: McpServer): void {
  server.resource(
    "id-types",
    "hacienda://reference/id-types",
    {
      description:
        "Reference data for Costa Rica identification types used in electronic invoicing. " +
        "Includes type codes, expected lengths, descriptions, and examples.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "hacienda://reference/id-types",
          mimeType: "application/json",
          text: JSON.stringify(ID_TYPES_REFERENCE, null, 2),
        },
      ],
    }),
  );
}
