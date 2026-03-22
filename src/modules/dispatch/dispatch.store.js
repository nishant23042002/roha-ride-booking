// /src/modules/dispatch/dispatch.store.js

const store = new Map();

export const dispatchState = {
  init(rideId) {
    store.set(rideId, {
      acceptedDriver: null,
      rejectedDrivers: new Map(),
    });
  },

  setAccepted(rideId, driverId) {
    const data = store.get(rideId);
    if (!data) return;

    data.acceptedDriver = driverId;
  },

  addRejected(rideId, driverId) {
    const data = store.get(rideId);
    if (!data) return;

    data.rejectedDrivers.set(driverId, Date.now());
  },

  get(rideId) {
    return store.get(rideId);
  },

  clear(rideId) {
    store.delete(rideId);
  },
};
