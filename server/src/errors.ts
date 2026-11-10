export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: () =>
    new ApiError(401, "UNAUTHORIZED", "Credential is missing or invalid"),
  forbidden: () =>
    new ApiError(403, "FORBIDDEN", "Credential cannot access this resource"),
  notFound: () =>
    new ApiError(404, "NOT_FOUND", "Requested resource does not exist"),
  pairingExpired: () =>
    new ApiError(410, "PAIRING_SESSION_EXPIRED", "Pairing session expired"),
  pairingClaimed: () =>
    new ApiError(409, "PAIRING_SESSION_CLAIMED", "Pairing session was claimed"),
  invalidClaim: () =>
    new ApiError(403, "INVALID_CLAIM_SECRET", "Claim secret is invalid"),
  pairingRequired: () =>
    new ApiError(409, "PAIRING_REQUIRED", "No active pairing exists"),
  pairingConflict: () =>
    new ApiError(
      409,
      "PAIRING_CONFLICT",
      "One of the devices already has an active pairing",
    ),
  pairingRevoked: () =>
    new ApiError(401, "PAIRING_REVOKED", "Pairing has been revoked"),
  messageExpired: () =>
    new ApiError(410, "MESSAGE_EXPIRED", "Message already expired"),
  clockSkew: () =>
    new ApiError(
      400,
      "CLOCK_SKEW_TOO_LARGE",
      "Device time differs from server time by more than ten minutes",
    ),
};
