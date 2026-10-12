/** Share one operation slot between the terminal and its browser dashboard. */
export class OperationCoordinator {
  constructor() { this.active = null; }
  acquire(label, controller) {
    if (this.active) throw Object.assign(new Error(`Another operation is running: ${this.active.label}. Wait for it to finish or cancel it in its original view.`), { status: 409, code: 'OPERATION_BUSY' });
    const entry = { label, controller }; this.active = entry;
    return () => { if (this.active === entry) this.active = null; };
  }
}
