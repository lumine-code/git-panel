/** @babel */
import yubikiri from "yubikiri";
import { Emitter, CompositeDisposable } from "atom";

import Author, { nullAuthor } from "./author";
import ModelObserver from "./model-observer";

// This is a guess about what a reasonable value is. Can adjust if performance is poor.
const MAX_COMMITS = 5000;

export const source = {
  PENDING: Symbol("pending"),
  GITLOG: Symbol("git log"),
};

export default class UserStore {
  constructor({ repository, config }) {
    this.emitter = new Emitter();
    this.subs = new CompositeDisposable();

    this.allUsers = new Map();
    this.authorOrder = new Map();
    this.orderCounter = 0;
    this.excludedUsers = new Set();
    this.users = [];
    this.committer = nullAuthor;

    this.last = {
      source: source.PENDING,
      repository: null,
      excludedUsers: this.excludedUsers,
    };

    this.repositoryObserver = new ModelObserver({
      fetchData: (r) =>
        yubikiri({
          committer: r.getCommitter(),
          authors: r.getAuthors({ max: MAX_COMMITS }),
        }),
      didUpdate: () => this.loadUsers(),
    });
    this.repositoryObserver.setActiveModel(repository);

    this.subs.add(
      config.observe("git-panel.excludedUsers", (value) => {
        this.excludedUsers = new Set(
          (value || "").split(/\s*,\s*/).filter((each) => each.length > 0),
        );
        return this.loadUsers();
      }),
    );
  }

  dispose() {
    this.subs.dispose();
    this.emitter.dispose();
  }

  async loadUsers() {
    const data = this.repositoryObserver.getActiveModelData();

    if (!data) {
      return;
    }

    this.setCommitter(data.committer);
    this.addUsers(data.authors, source.GITLOG);
  }

  addUsers(users, nextSource) {
    let changed = false;

    if (
      nextSource !== this.last.source ||
      this.repositoryObserver.getActiveModel() !== this.last.repository ||
      this.excludedUsers !== this.last.excludedUsers
    ) {
      changed = true;
      this.allUsers.clear();
      this.authorOrder.clear();
      this.orderCounter = 0;
    }

    for (const author of users) {
      if (!this.allUsers.has(author.getEmail())) {
        changed = true;
        this.authorOrder.set(author.getEmail(), this.orderCounter++);
      }
      this.allUsers.set(author.getEmail(), author);
    }

    if (changed) {
      this.finalize();
    }
    this.last.source = nextSource;
    this.last.repository = this.repositoryObserver.getActiveModel();
    this.last.excludedUsers = this.excludedUsers;
  }

  finalize() {
    const users = [];
    for (const author of this.allUsers.values()) {
      if (author.matches(this.committer)) {
        continue;
      }
      if (author.isNoReply()) {
        continue;
      }
      if (this.excludedUsers.has(author.getEmail())) {
        continue;
      }

      users.push(author);
    }
    // Sort by most recently seen first (git log order), then alphabetically as tiebreaker.
    users.sort((a, b) => {
      const orderA = this.authorOrder.get(a.getEmail()) ?? Infinity;
      const orderB = this.authorOrder.get(b.getEmail()) ?? Infinity;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return Author.compare(a, b);
    });
    this.users = users;
    this.didUpdate();
  }

  setRepository(repository) {
    this.repositoryObserver.setActiveModel(repository);
  }

  setCommitter(committer) {
    const changed = !this.committer.matches(committer);
    this.committer = committer;
    if (changed) {
      this.finalize();
    }
  }

  didUpdate() {
    this.emitter.emit("did-update", this.getUsers());
  }

  onDidUpdate(callback) {
    return this.emitter.on("did-update", callback);
  }

  getUsers() {
    return this.users;
  }
}
