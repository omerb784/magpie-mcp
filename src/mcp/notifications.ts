type Notifier = () => void;

let resourcesListChanged: Notifier = () => {};

export function setResourcesListChangedNotifier(fn: Notifier): void {
  resourcesListChanged = fn;
}

export function notifyResourcesChanged(): void {
  resourcesListChanged();
}
