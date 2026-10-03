export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const radius = {
  card: 18,
  cardLg: 22,
  button: 14,
  chip: 999,
  photo: 14,
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  prominent: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

// Fixed height reserved at the bottom of every screen so content can
// scroll clear of the bottom nav bar.
export const BOTTOM_NAV_HEIGHT = 84;
