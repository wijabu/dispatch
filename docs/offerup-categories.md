# OfferUp category taxonomy (captured live 2026-07-15)

Captured from the OfferUp Android app's "Select a category" picker (the full item
taxonomy is in-app only; OfferUp does not publish it on the web). Each top-level
category expands to subcategories; every group ends with an "Other - <Category>".
These exact display strings are what the automation matches on.

Item posting requires: top-level category → subcategory (two-level selection).

## Top-level categories (12 confirmed)
Electronics & Media · Home & Garden · Clothing, Shoes, & Accessories · Baby & Kids ·
Vehicles · Toys, Games, & Hobbies · Sports & Outdoors · Collectibles & Art ·
Pet supplies · Health & Beauty · Wedding · Business equipment
_(“Tickets” and “General” also appear at the list bottom — likely 2 more top-levels; confirm when wiring.)_

## Subcategories

**Electronics & Media:** Audio & Speakers · Cell phones & Accessories · Cameras & Photography · TVs & Media players · Video games & Consoles · Computers & Accessories · Books, Movies, & Music · Wearables · Drones · Virtual reality · 3D Printers & Supplies · Other

**Home & Garden:** Furniture · Household · Appliances · Kitchen & Dining · Bathroom · Tools & Machinery · Home improvement · Lawn & Garden · Home decor · Other

**Clothing, Shoes, & Accessories:** Women's clothing · Men's clothing · Women's shoes · Men's shoes · **Jewelry & Accessories** · Girls' clothing · Boys' clothing · Baby & Toddler girl clothing · Baby & Toddler boy clothing · Baby & Toddler accessories · Girls' shoes · Girls' accessories · Boys' shoes · Boys' accessories · Other

**Baby & Kids:** Girls' accessories · Boys' accessories · Bathing & Skincare · Car seats & Accessories · Diapering · Feeding · Baby gear · Health & Baby care · Nursery furniture & Decor · Potty training · Pregnancy & Maternity · Baby safety · Strollers & Accessories · Baby toys · Other

**Vehicles:** Cars & Trucks · Motorcycles · Campers & RVs · Boats & Marine · Powersport vehicles · Trailers · Commercial vehicles · Tires & Rims · Auto parts & Accessories · Other

**Toys, Games, & Hobbies:** Toys · Games & Puzzles · Outdoor toys & Games · Stuffed animals & Plush · Dress up & Pretend · Trading cards · Musical instruments · Other

**Sports & Outdoors:** Exercise · Yoga & Pilates · Mixed martial arts & Boxing · Bikes & Cycling · Skateboarding · Fishing · Camping & Hiking · Water sports · Ice & Snow sports · Lawn games · Team sports · Golf · Fan shop · Other

**Collectibles & Art:** Art · Arts & Crafts supplies · Antiques · Collectibles · Handmade · Other

**Pet supplies:** Pet collars & Leashes · Pet clothing, Accessories, & Shoes · Pet toys · Pet feeding · Pet bedding · Pet furniture · Pet carriers & Houses · Pet health & Wellness · Training · Pet gates & Fences · Other

**Health & Beauty:** Hair care · Bath & Body · Makeup & Cosmetics · Skincare · Fragrance · Personal care · Tools & Accessories · Other

**Wedding:** Jewelry · Invitations & Paper · Gifts & Mementos · Decorations · Accessories · Clothing · Shoes · Other

**Business equipment:** Farming & Agriculture · Building materials & Supplies · Cleaning & Janitorial supplies · Electrical equipment & Supplies · Facility maintenance & Safety · Fasteners & Hardware · HVAC · Light industrial equipment & Tools · Material handling · Office equipment & Supplies · Restaurant & Food service equipment · Printing & Graphic arts · Retail & Services · Industrial fuel & Energy equipment · Other

## Dispatch item-category → OfferUp mapping (proposed)
| Dispatch category | OfferUp top-level | OfferUp subcategory |
|---|---|---|
| watches | Clothing, Shoes, & Accessories | Jewelry & Accessories |
| furniture | Home & Garden | Furniture |
| electronics | Electronics & Media | (per item; default Computers & Accessories) |
| general | (needs Wil's call — likely "General" top-level, or best-fit per item) |
