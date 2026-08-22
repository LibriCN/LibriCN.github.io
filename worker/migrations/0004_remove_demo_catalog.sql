-- Remove somente os registros do catálogo demonstrativo anterior.
-- Os dados reais cadastrados pelo usuário não usam estes IDs.
DELETE FROM library_books WHERE id IN ('lb1','lb2','lb3','lb4','lb5','lb6','lb7','lb8','lb9');
DELETE FROM books WHERE id IN ('b1','b2','b3','b4','b5','b6');
DELETE FROM libraries WHERE id IN ('l1','l2','l3');
DELETE FROM suggestions WHERE id IN ('s1','s2');
