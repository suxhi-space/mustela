/** A count on a red badge: past 99 it reads "99+" (the badge grows into a pill for two or more characters). */
export const badgeNum = (n: number) => (n > 99 ? "99+" : String(n));
